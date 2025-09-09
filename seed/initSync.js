// seed/initSync.js
require('dotenv').config();
const connectDB = require('../config/db');

const Club = require('../models/Club');
const Player = require('../models/Player');

// Map detailed roles to fantasy positions
function mapRoleToPosition(role) {
  if (!role) return 'MID';
  const r = String(role).trim().toLowerCase();

  // GK
  if (r.includes('keeper') || r === 'gk' || r === 'goalkeeper') return 'GK';

  // DEF
  if (r.includes('centre-back') || r.includes('center-back') || r.includes('centre back') || r.includes('center back')) return 'DEF';
  if (r.includes('left-back') || r.includes('left back')) return 'DEF';
  if (r.includes('right-back') || r.includes('right back')) return 'DEF';
  if (r.includes('full-back') || r.includes('full back')) return 'DEF';
  if (r === 'defender') return 'DEF';

  // MID
  if (r.includes('midfield')) return 'MID'; // defensive/central/attacking midfield => MID
  if (r === 'mid' || r === 'midfielder') return 'MID';

  // FWD
  if (r.includes('winger')) return 'FWD'; // left/right winger => FWD (as requested)
  if (r.includes('forward')) return 'FWD'; // centre-forward, forward
  if (r.includes('striker') || r.includes('attacker')) return 'FWD';
  if (r === 'fwd') return 'FWD';

  // Fallback
  return 'MID';
}

// Deterministic team API IDs (avoid collisions with your API-Football IDs)
const TEAM_API_IDS = {
  'Wydad Athletic': 1001,
  'Renaissance de Berkane': 1002,
  'Raja Athletic': 1003,
  'AS FAR': 1004
};

// Simple short names
const TEAM_SHORTS = {
  'Wydad Athletic': 'WAC',
  'Renaissance de Berkane': 'RSB',
  'Raja Athletic': 'RCA',
  'AS FAR': 'FAR'
};

// Minimal stadium/city info
const TEAM_META = {
  'Wydad Athletic': { city: 'Casablanca', stadium: 'Stade Mohammed V' },
  'Renaissance de Berkane': { city: 'Berkane', stadium: 'Stade Municipal de Berkane' },
  'Raja Athletic': { city: 'Casablanca', stadium: 'Stade Mohammed V' },
  'AS FAR': { city: 'Rabat', stadium: 'Stade Prince Moulay Abdellah' }
};

// DATA YOU PROVIDED
const DATA = [
  {
    club: 'Wydad Athletic',
    players: [
      { name: 'El Mehdi Benabid', role: 'Goalkeeper' },
      { name: 'Youssef El Motie', role: 'Goalkeeper' },
      { name: 'Abdelali Mhamdi', role: 'Goalkeeper' },
      { name: 'Omar Aqzdaou', role: 'Goalkeeper' },

      { name: 'Bart Meijers', role: 'Centre-Back' },
      { name: 'Amine Aboulfath', role: 'Centre-Back' },
      { name: 'Guilherme Ferreira', role: 'Centre-Back' },
      { name: 'Ayman Dairani', role: 'Centre-Back' },
      { name: 'Mohammed El Jadidi', role: 'Centre-Back' },

      { name: 'Ayoub Boucheta', role: 'Left-Back' },
      { name: 'Mohamed Moufid', role: 'Right-Back' },
      { name: 'Mohamed Bouchouari', role: 'Right-Back' },
      { name: 'Walid Atik', role: 'Right-Back' },

      { name: 'Abdelghafour Lamirat', role: 'Defensive Midfield' },
      { name: 'Rayane Mahtou', role: 'Defensive Midfield' },
      { name: 'Oussama Zemraoui', role: 'Central Midfield' },
      { name: 'Walid Sabbar', role: 'Central Midfield' },
      { name: 'Joseph Bakasu', role: 'Central Midfield' },

      { name: 'Hamza Sakhi', role: 'Attacking Midfield' },
      { name: 'Arthur Wenderroscky', role: 'Attacking Midfield' },
      { name: 'Pedrinho', role: 'Attacking Midfield' },
      { name: 'Stephane Aziz Ki', role: 'Attacking Midfield' },
      { name: 'Mouad Enzo', role: 'Attacking Midfield' },

      { name: 'Mohamed Rayhi', role: 'Left Winger' },
      { name: 'Thembinkosi Lorch', role: 'Left Winger' },
      { name: 'Hamza Elowasti', role: 'Left Winger' },
      { name: 'Zouhair El Moutaraji', role: 'Left Winger' },
      { name: 'Mohamed El Ouardi', role: 'Left Winger' },

      { name: 'Walid Nassi', role: 'Right Winger' },
      { name: 'Nordin Amrabat', role: 'Right Winger' },

      { name: 'Hamza Hannouri', role: 'Centre-Forward' },
      { name: 'Tumisang Orebonye', role: 'Centre-Forward' },
      { name: 'Chamss Eddine El Allaly', role: 'Centre-Forward' }
    ]
  },
  {
    club: 'Renaissance de Berkane',
    players: [
      { name: 'Munir El Kajoui', role: 'Goalkeeper' },
      { name: 'Mehdi Maftah', role: 'Goalkeeper' },
      { name: 'Kamal Bilal', role: 'Goalkeeper' },

      { name: 'Ismaël Kandouss', role: 'Centre-Back' },
      { name: 'Abdelhak Assal', role: 'Centre-Back' },
      { name: 'Oussama Haddadi', role: 'Centre-Back' },
      { name: 'Amine El Maswab', role: 'Centre-Back' },

      { name: 'Hamza El Moussaoui', role: 'Left-Back' },
      { name: 'Mohamed Aymen Sadil', role: 'Left-Back' },

      { name: 'Haytam Manaout', role: 'Right-Back' },
      { name: 'Et-Tayeb Boukhriss', role: 'Right-Back' },

      { name: 'Mamadou Lamine Camara', role: 'Defensive Midfield' },
      { name: 'Soumaila Sidibe', role: 'Defensive Midfield' },

      { name: 'Ayoub Khairi', role: 'Central Midfield' },
      { name: 'Rayane Aabid', role: 'Central Midfield' },
      { name: 'Mohamed Ouyahia', role: 'Central Midfield' },

      { name: 'Yassine Labhiri', role: 'Attacking Midfield' },
      { name: 'Zinédine Machach', role: 'Attacking Midfield' },
      { name: 'Mohamed El Morabit', role: 'Attacking Midfield' },
      { name: 'Reda Hajji', role: 'Attacking Midfield' },

      { name: 'Mounir Chouiar', role: 'Left Winger' },
      { name: 'Youssef Mehri', role: 'Left Winger' },

      { name: 'Imad Riahi', role: 'Right Winger' },
      { name: 'Amine Azri', role: 'Right Winger' },

      { name: 'Oussama Lamlioui', role: 'Centre-Forward' },
      { name: 'Paul Bassène', role: 'Centre-Forward' },
      { name: 'Youness El Kaabi', role: 'Centre-Forward' }
    ]
  },
  {
    club: 'Raja Athletic',
    players: [
      { name: 'Khalid Kbiri Alaoui', role: 'Goalkeeper' },
      { name: 'El Mehdi Al Harrar', role: 'Goalkeeper' },
      { name: 'Yassine Zoubir', role: 'Goalkeeper' },

      { name: 'Badr Benoun', role: 'Centre-Back' },
      { name: 'Abdellah Khafifi', role: 'Centre-Back' },
      { name: 'Mehdi Mchakhchekh', role: 'Centre-Back' },
      { name: 'Bouchaib Arrassi', role: 'Centre-Back' },
      { name: 'Ismail Mokadem', role: 'Centre-Back' },

      { name: 'Youssef Belammari', role: 'Left-Back' },

      { name: 'Mohamed Boulacsout', role: 'Right-Back' },
      { name: 'Abdelkarim Baadi', role: 'Right-Back' },

      { name: 'Moses Orkuma', role: 'Defensive Midfield' },
      { name: 'Othmane Chraibi', role: 'Defensive Midfield' },

      { name: 'Mohamed Al-Makahasi', role: 'Central Midfield' },
      { name: 'Hilal Ferdaoussi', role: 'Central Midfield' },

      { name: 'Sabir Bougrine', role: 'Attacking Midfield' },

      { name: 'Mouad Dahak', role: 'Left Winger' },
      { name: 'Adam Ennaffati', role: 'Left Winger' },
      { name: 'Pape Ousmane Sakho', role: 'Left Winger' },

      { name: 'Bilal Ould-Chikh', role: 'Right Winger' },
      { name: 'Younes Najari', role: 'Right Winger' },
      { name: 'Ayoub Maamouri', role: 'Right Winger' },

      { name: 'Víctor Ábrego', role: 'Centre-Forward' },
      { name: 'Ismail Khafi', role: 'Centre-Forward' }
    ]
  },
  {
    club: 'AS FAR',
    players: [
      { name: 'Ahmed Reda Tagnaouti', role: 'Goalkeeper' },
      { name: 'Ayoub El Khayati', role: 'Goalkeeper' },

      { name: 'Marouane Louadni', role: 'Centre-Back' },
      { name: 'Yunis Abdelhamid', role: 'Centre-Back' },
      { name: 'Fallou Mendy', role: 'Centre-Back' },
      { name: 'Nouh Mohamed El Abd', role: 'Centre-Back' },
      { name: 'Ayoub Ait Khassou', role: 'Centre-Back' },

      { name: 'Jamal Ech-Chamakh', role: 'Left-Back' },
      { name: 'Tó Carneiro', role: 'Left-Back' },

      { name: 'Mohamed Rabie Hrimat', role: 'Defensive Midfield' },
      { name: 'Anas Bach', role: 'Defensive Midfield' },
      { name: 'Zineddine Derrag', role: 'Defensive Midfield' },

      { name: 'Abdelfettah Hadraf', role: 'Central Midfield' },
      { name: 'Taoufik Razko', role: 'Central Midfield' },

      { name: 'Khalid Aït Ouarkhane', role: 'Attacking Midfield' },
      { name: 'Soulaimane El Bouchqali', role: 'Attacking Midfield' },
      { name: 'Zakaria Ajoughlal', role: 'Attacking Midfield' },

      { name: 'Youssef El Fahli', role: 'Left Winger' },
      { name: 'Ahmed Hammoudan', role: 'Left Winger' },

      { name: 'Reda Slim', role: 'Right Winger' },
      { name: 'Achref Habbassi', role: 'Right Winger' },

      { name: 'Hamza Khabba', role: 'Centre-Forward' },
      { name: 'Mouhcine Bouriga', role: 'Centre-Forward' },
      { name: 'Destin Maniriho', role: 'Striker' }
    ]
  }
];

// Find or create a club (by apiId or name), then ensure core fields are set
async function upsertClub(clubName) {
  const apiId = TEAM_API_IDS[clubName];
  const shortName = TEAM_SHORTS[clubName] || clubName.substring(0, 3).toUpperCase();
  const meta = TEAM_META[clubName] || { city: 'Morocco', stadium: '—' };

  // Try find by apiId or exact name
  let club = await Club.findOne({ $or: [{ apiId }, { name: clubName }] });
  if (!club) {
    club = await Club.create({
      apiId,
      name: clubName,
      shortName,
      logo: '',
      stadium: meta.stadium,
      city: meta.city
    });
  } else {
    // Ensure core fields are set/updated
    club.apiId = apiId;
    club.name = clubName;
    club.shortName = club.shortName || shortName;
    club.stadium = club.stadium || meta.stadium;
    club.city = club.city || meta.city;
    await club.save();
  }
  return club;
}

// Seed one club's players with deterministic player apiIds
async function seedClubPlayers(clubDoc, players) {
  const teamApiId = clubDoc.apiId;
  let created = 0;
  let updated = 0;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const pos = mapRoleToPosition(p.role);
    const apiId = teamApiId * 1000 + (i + 1); // deterministic unique id per player

    const payload = {
      apiId,
      name: p.name.trim(),
      position: pos,
      club: clubDoc._id,
      apiTeamId: teamApiId,
      isActive: true
      // price/stats left to defaults as requested
    };

    const existing = await Player.findOne({ apiId });
    if (existing) {
      // Update safe fields; don't touch price/stats if you don't want to
      existing.name = payload.name;
      existing.position = payload.position;
      existing.club = payload.club;
      existing.apiTeamId = payload.apiTeamId;
      existing.isActive = true;
      await existing.save();
      updated++;
    } else {
      await Player.create(payload);
      created++;
    }
  }
  return { created, updated };
}

(async () => {
  try {
    await connectDB();

    console.log('Seeding clubs and players (upsert, no deletions)...');

    let totalCreated = 0;
    let totalUpdated = 0;

    for (const block of DATA) {
      const clubDoc = await upsertClub(block.club);
      const { created, updated } = await seedClubPlayers(clubDoc, block.players);
      totalCreated += created;
      totalUpdated += updated;
      console.log(` - ${block.club}: players created=${created}, updated=${updated}`);
    }

    console.log(`Done. Total players created=${totalCreated}, updated=${totalUpdated}.`);
    console.log('Note: Users were not deleted or modified.');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
})();
