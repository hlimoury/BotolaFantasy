
// scoring.js
const cfg = require('../config/scoring');

function parsePosition(apiPos) {
  // API-FOOTBALL positions: "G", "D", "M", "F" / or from statistics.games.position: "Goalkeeper" etc.
  if (!apiPos) return 'MID';
  const p = apiPos.toLowerCase();
  if (p.startsWith('g')) return 'GK';
  if (p.startsWith('d')) return 'DEF';
  if (p.startsWith('m')) return 'MID';
  if (p.startsWith('f') || p.startsWith('a')) return 'FWD';
  return 'MID';
}

function computePoints(position, s) {
  let pts = 0;
  
  // Minutes
  if (s.minutesPlayed >= 90) pts += cfg.minutes.fullMatch;
  else if (s.minutesPlayed >= 60) pts += cfg.minutes.threshold60;
  
  // Goals
  if (s.goals) pts += cfg.goals[position] * s.goals;
  
  // Assists
  if (s.assists) pts += cfg.assists * s.assists;
  
  // Clean sheet
  if (s.cleanSheet) pts += cfg.cleanSheet[position];
  
  // Cards
  if (s.yellowCard) pts += cfg.cards.yellow;
  if (s.redCard) pts += cfg.cards.red;
  
  // GK Saves
  if (s.saves) pts += Math.floor(s.saves / cfg.saves.per) * cfg.saves.points;
  
  // Penalties
  if (s.penaltiesSaved) pts += cfg.penalty.saved * s.penaltiesSaved;
  if (s.penaltiesMissed) pts += cfg.penalty.missed * s.penaltiesMissed;
  
  // Conceded goals penalty (GK/DEF)
  if ((position === 'GK' || position === 'DEF') && s.conceded && s.conceded > 0) {
    pts += -Math.floor(s.conceded / cfg.conceded.perGoals) * cfg.conceded[position];
  }
  
  // Own goals
  if (s.ownGoals) pts += cfg.ownGoal * s.ownGoals;
  
  // NEW: Man of the Match bonus
  if (s.isManOfTheMatch) pts += (cfg.motm || 3);
  
  return pts;
}

module.exports = { parsePosition, computePoints };
