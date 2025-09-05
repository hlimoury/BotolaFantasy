const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const cron = require('node-cron');
const passport = require('passport');
require('dotenv').config();

require('./config/passport')(); // initialize strategies
const connectDB = require('./config/db');

// Routes
const authRoutes = require('./routes/auth');
const clubRoutes = require('./routes/clubs');
const playerRoutes = require('./routes/players');
const teamRoutes = require('./routes/teams');
const adminRoutes = require('./routes/admin');
const leaderboardRoutes = require('./routes/leaderboard');
const gameweekRoutes = require('./routes/gameweeks');
const publicClubsRoutes = require('./routes/clubsPublic');
const friendsRoutes = require('./routes/friends');
const leaguesRoutes = require('./routes/leagues');

// Sync service
const { autoSyncTick } = require('./services/sync');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// DB
connectDB();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// For Render/Proxies: trust proxy so secure cookies work behind HTTPS
if (isProd) app.set('trust proxy', 1);

// Middleware
app.use(cors()); // keep open; same-origin front-end calls
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(morgan('dev'));

// Sessions for SSR pages
app.use(
  session({
    secret: (process.env.SESSION_SECRET || '').trim(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProd,        // HTTPS on Render
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);

// Passport (session: false for OAuth strategy, but we still init)
app.use(passport.initialize());

// Attach user to views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// Healthcheck for Render
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/gameweeks', gameweekRoutes);
app.use('/api/clubs', publicClubsRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/leagues', leaguesRoutes);

// ALSO mount at /auth to match GOOGLE_CALLBACK_URL like https://your-app.onrender.com/auth/google/callback
app.use('/auth', authRoutes);

// Pages
app.get('/', (req, res) => res.render('index', { title: 'Home' }));
app.get('/login', (req, res) => res.render('login', { title: 'Login' }));
app.get('/signup', (req, res) => res.render('signup', { title: 'Sign Up' }));
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('dashboard', { title: 'Dashboard' });
});
app.get('/leaderboard', (req, res) => res.render('leaderboard', { title: 'Leaderboard' }));
app.get('/admin', (req, res) => {
  if (!req.session.user || !req.session.user.isAdmin) return res.redirect('/login');
  res.render('admin', { title: 'Admin' });
});
app.get('/friends', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('friends', { title: 'Friends' });
});
app.get('/leagues', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('leagues', { title: 'Leagues' });
});

// Cron: run sync every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  try {
    await autoSyncTick();
  } catch (e) {
    console.error('Auto sync error:', e.message);
  }
});

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
