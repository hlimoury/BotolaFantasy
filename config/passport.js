// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

module.exports = function initPassport() {
  const isProd = process.env.NODE_ENV === 'production';
  const defaultCallbackURL = isProd
    ? 'https://botolafantasy.onrender.com/auth/google/callback'
    : 'http://localhost:3000/auth/google/callback';

  passport.use(new GoogleStrategy(
    {
      clientID: (process.env.GOOGLE_CLIENT_ID || '').trim(),
      clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
      callbackURL: (process.env.GOOGLE_CALLBACK_URL || defaultCallbackURL).trim()
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = (profile.emails && profile.emails[0]?.value)
          ? profile.emails[0].value.toLowerCase()
          : null;
        const avatar = profile.photos && profile.photos[0]?.value;

        let user = await User.findOne({ googleId });
        if (!user && email) {
          user = await User.findOne({ email });
          if (user) {
            user.googleId = googleId;
            user.avatar = avatar || user.avatar;
            await user.save();
          }
        }
        if (!user) {
          const baseUsername = (profile.displayName || (email ? email.split('@')[0] : 'user')).replace(/\s+/g, '');
          let username = baseUsername;
          let i = 1;
          while (await User.findOne({ username })) username = `${baseUsername}${i++}`;
          user = await User.create({ username, email, googleId, avatar });
        }
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
};
