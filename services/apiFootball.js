const axios = require('axios');

const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': process.env.APIFOOTBALL_API_KEY
  },
  timeout: 20000
});

const leagueId = () => process.env.APIFOOTBALL_LEAGUE_ID;
const season = () => process.env.APIFOOTBALL_SEASON;
const timezone = () => process.env.APIFOOTBALL_TIMEZONE || 'Africa/Casablanca';

module.exports = {
  getLeagueInfo: async () => {
    const res = await api.get('/leagues', { params: { id: leagueId(), season: season() } });
    return res.data.response?.[0];
  },
  getTeams: async () => {
    const res = await api.get('/teams', { params: { league: leagueId(), season: season() } });
    return res.data.response.map((r) => r.team);
  },
  getTeamPlayers: async (teamId, page = 1) => {
    const res = await api.get('/players', {
      params: { team: teamId, league: leagueId(), season: season(), page }
    });
    return {
      players: res.data.response,
      paging: res.data.paging
    };
  },
  getFixturesByRound: async (round) => {
    // round example: "Regular Season - 10"
    const res = await api.get('/fixtures', {
      params: { league: leagueId(), season: season(), round, timezone: timezone() }
    });
    return res.data.response;
  },
  getAllFixtures: async () => {
    const res = await api.get('/fixtures', {
      params: { league: leagueId(), season: season(), timezone: timezone() }
    });
    return res.data.response;
  },
  getFixturePlayers: async (fixtureId) => {
    const res = await api.get('/fixtures/players', { params: { fixture: fixtureId } });
    return res.data.response;
  },
  getRounds: async () => {
    const res = await api.get('/fixtures/rounds', { params: { league: leagueId(), season: season() } });
    return res.data.response; // array of strings "Regular Season - 1", ...
  }
};
