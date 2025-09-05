const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const cron = require('node-cron');
require('dotenv').config();
const passport = require('passport');
require('./config/passport')(); // initialize strategies
require('dotenv').config();

const connectDB = require('./config/db');

// Routes
const authRoutes = require('./routes/auth');
const clubRoutes = require('./routes/clubs');
const playerRoutes = require('./routes/players');
const teamRoutes = require('./routes/teams');
const adminRoutes = require('./routes/admin');
const leaderboardRoutes = require('./routes/leaderboard');
const gameweekRoutes = require('./routes/gameweeks');

// Sync service
const { autoSyncTick } = require('./services/sync');

const app = express();

// DB
connectDB();

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(morgan('dev'));
app.use(passport.initialize());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/gameweeks', gameweekRoutes);
app.use('/api/friends', require('./routes/friends'));
app.use('/api/leagues', require('./routes/leagues'));


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

// NEW: Friends & Leagues pages (protected)
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
