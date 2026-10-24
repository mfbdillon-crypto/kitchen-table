// Kitchen Table — saved game plans for the AI, one per ready-made deck (precons.js ids).
// The AI only plays these decks. Each profile tells it how its deck wins, which ~10 cards make the engine work,
// what to protect, which combos it may go for (only when the deck's bracket allows it), and — for opponents —
// how to fight this deck. When a new ready-made deck is added, add its profile here.
//
// Fields
//   arch      game-plan families (see ARCHETYPES below); the first one drives the plan
//   plan      one-line summary shown in the dev plan panel
//   win       win routes in order of preference: combat-wide | combat-big | voltron | cmdr-damage | flyers | drain | poison | burn | alt-win | combo
//   cmdrRole  engine | threat | value | enabler (how much the plan depends on the commander being on the battlefield)
//   cmdrTurn  the earliest turn it wants the commander out (it still casts it later if it can't)
//   key       the ~10 cards that make the deck work (higher priority to cast, find, protect)
//   protect   permanents worth a counterspell / protection spell
//   finishers cards that end the game when the board is set up
//   combos    [{ cards, note, kind }] — kind: infinite | engine. Pursued only when profile.bracket >= 3 (infinite) / any (engine)
//   vs        how an opponent should beat this deck: kill (cards to remove on sight), hate (graveyard | artifacts | enchantments | tokens | flyers),
//             wipeAt (wipe when this many of its creatures are out), counter (spell kinds worth countering), note
(function (root) {
  'use strict';
  const P = {
    // ---------------- Bracket 1 ----------------
    'suiUheeJvkWIWDUHHpE_Ww': {
      cmdr: 'Erebos, God of the Dead', arch: ['drain', 'control'], cmdrRole: 'value', cmdrTurn: 4,
      plan: 'Slow everyone down with board wipes and edicts, then drain the table with damage-and-life-loss enchantments while Erebos stops lifegain and draws cards.',
      win: ['drain', 'combat-big'],
      key: ['Underworld Dreams', 'Revenge of Ravens', 'Sanctum of Stone Fangs', 'Night of Souls\' Betrayal', 'The Meathook Massacre', 'Phyrexian Arena', 'No Mercy', 'Warlock Class', 'Cabal Coffers', 'Nykthos, Shrine to Nyx'],
      protect: ['Underworld Dreams', 'Sanctum of Stone Fangs', 'The Meathook Massacre', 'Revenge of Ravens'],
      finishers: ['Sorin\'s Vengeance', 'Death of a Thousand Stings', 'Killing Wave', 'Ob Nixilis, the Hate-Twisted'],
      wipes: ['Damnation', 'Toxic Deluge', 'Black Sun\'s Zenith', 'Mutilate', 'Decree of Pain', 'Barter in Blood'],
      combos: [],
      vs: { kill: ['Underworld Dreams', 'Sanctum of Stone Fangs', 'The Meathook Massacre', 'Revenge of Ravens'], hate: ['enchantments'], wipeAt: 0, counter: ['enchantment', 'wipe'], note: 'Erebos is indestructible and usually not a creature — remove its drain enchantments instead and keep attacking, it has few blockers.' }
    },
    '95ejylF5dUCymfCG30d3Xw': {
      cmdr: 'Karador, Ghost Chieftain', arch: ['graveyard', 'value'], cmdrRole: 'engine', cmdrTurn: 5,
      plan: 'Fill the graveyard with self-mill creatures, cast Karador cheaply, then replay a creature from the graveyard every turn and grind value.',
      win: ['combat-wide', 'combat-big'],
      key: ['Satyr Wayfinder', 'Stoic Builder', 'Grim Flowering', 'Ulvenwald Mysteries', 'Necromancer\'s Assistant', 'Twisted Abomination', 'Lotleth Giant', 'Eerie Soultender', 'Morkrut Banshee', 'Plagued Rusalka'],
      protect: ['Karador, Ghost Chieftain', 'Ulvenwald Mysteries'],
      finishers: ['Lotleth Giant', 'Phyrexian Gargantua', 'Twisted Abomination', 'Jubilation'],
      wipes: [],
      combos: [],
      vs: { kill: ['Karador, Ghost Chieftain'], hate: ['graveyard'], wipeAt: 5, counter: ['commander'], note: 'Exile its graveyard and kill Karador — without them it is a pile of fair creatures.' }
    },
    'sJUhp6m9aE6O4m3PHBAbfg': {
      cmdr: 'Denethor, Stone Seer', arch: ['spellslinger', 'flyers', 'monarch'], cmdrRole: 'enabler', cmdrTurn: 2,
      plan: 'Become the monarch (Denethor, Courts) and keep it with flying blockers, draw lots of cards with instants, and win with flyers and tokens.',
      win: ['flyers', 'combat-wide'],
      key: ['Court of Ire', 'Court of Embereth', 'The Locust God', 'Shark Typhoon', 'Improbable Alliance', 'Curiosity Crafter', 'Spectral Sailor', 'Fact or Fiction', 'Memory Deluge', 'Stormtide Leviathan'],
      protect: ['The Locust God', 'Improbable Alliance', 'Court of Ire'],
      finishers: ['Stormtide Leviathan', 'Ryusei, the Falling Star', 'Skyline Despot', 'Court of Ire'],
      wipes: ['Blasphemous Act', 'Earthquake', 'Aetherize', 'Mudslide'],
      combos: [],
      vs: { kill: ['The Locust God', 'Improbable Alliance'], hate: ['flyers'], wipeAt: 4, counter: ['wipe', 'draw'], note: 'Take the monarch back in combat; it keeps counterspells up (Rewind, Spellgyre) so bait them before your key spell.' }
    },
    // ---------------- Bracket 2 ----------------
    'qyd4_Y2BX0S68fO6ICvSpA': {
      cmdr: 'Teysa Karlov', arch: ['aristocrats', 'tokens'], cmdrRole: 'engine', cmdrTurn: 4,
      plan: 'Make tokens and sacrifice them: every death drains each opponent (twice with Teysa). Win by drain, with lifelink tokens keeping it alive.',
      win: ['drain', 'combat-wide'],
      key: ['Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant', 'Viscera Seer', 'Carrion Feeder', 'Ashnod\'s Altar', 'Pitiless Plunderer', 'Midnight Reaper', 'Skullclamp', 'Endrek Sahr, Master Breeder'],
      protect: ['Teysa Karlov', 'Blood Artist', 'Zulaport Cutthroat', 'Ashnod\'s Altar', 'Pitiless Plunderer'],
      finishers: ['Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant', 'Requiem Angel'],
      wipes: ['Day of Judgment'],
      sacOutlets: ['Viscera Seer', 'Carrion Feeder', 'Ashnod\'s Altar', 'Altar of Dementia', 'Bartolomé del Presidio', 'Spawning Pit'],
      combos: [
        { kind: 'infinite', cards: ['Pitiless Plunderer', 'Ashnod\'s Altar', 'Reassembling Skeleton'], note: 'infinite death triggers and mana' },
        { kind: 'infinite', cards: ['Karmic Guide', 'Reveillark', 'Viscera Seer'], note: 'infinite death triggers' },
        { kind: 'engine', cards: ['Teysa Karlov', 'Blood Artist'], note: 'every death drains twice' }
      ],
      vs: { kill: ['Teysa Karlov', 'Blood Artist', 'Zulaport Cutthroat', 'Ashnod\'s Altar', 'Pitiless Plunderer'], hate: ['graveyard', 'tokens'], wipeAt: 5, counter: ['commander', 'creature'], note: 'Exile instead of destroy (deaths feed it); remove Teysa and the drain creatures first.' }
    },
    'U91Qi-WJuk2ImH4ntaJ8CQ': {
      cmdr: 'Dionus, Elvish Archdruid', arch: ['tribal', 'vehicles', 'ramp'], cmdrRole: 'engine', cmdrTurn: 3,
      plan: 'Elves tap for mana or crew, Dionus untaps them and grows them; crew big Vehicles every turn and swing.',
      win: ['combat-big', 'combat-wide'],
      key: ['Priest of Titania', 'Smuggler\'s Copter', 'Skysovereign, Consul Flagship', 'Weatherlight', 'Lifecraft Engine', 'Bomat Bazaar Barge', 'Gyre Sage', 'Wirewood Elf', 'Swiftfoot Boots', 'Lightning Greaves'],
      protect: ['Dionus, Elvish Archdruid', 'Priest of Titania'],
      finishers: ['Skysovereign, Consul Flagship', 'Mighty Servant of Leuk-o', 'Dawnsire, Sunstar Dreadnought', 'Surgehacker Mech'],
      wipes: [],
      combos: [],
      vs: { kill: ['Dionus, Elvish Archdruid', 'Priest of Titania'], hate: ['artifacts'], wipeAt: 5, counter: ['commander'], note: 'Its creatures are small elves; a wipe or blockers that survive Vehicles shut it down.' }
    },
    'rZvxj75L6UWTGQL1FJxV6A': {
      cmdr: 'Aesi, Tyrant of Gyre Strait', arch: ['landfall', 'ramp'], cmdrRole: 'engine', cmdrTurn: 4,
      plan: 'Ramp hard, land Aesi and play two-plus lands a turn to draw a card each time; win with Meloku tokens and big threats.',
      win: ['flyers', 'combat-big'],
      key: ['Exploration', 'Burgeoning', 'Azusa, Lost but Seeking', 'Lotus Cobra', 'Retreat to Coralhelm', 'Meloku the Clouded Mirror', 'Walking Atlas', 'Sakura-Tribe Scout', 'Kodama of the East Tree', 'Scapeshift'],
      protect: ['Aesi, Tyrant of Gyre Strait', 'Meloku the Clouded Mirror', 'Omniscience'],
      finishers: ['Meloku the Clouded Mirror', 'Omniscience', 'Patron of the Moon', 'Kiri-Onna'],
      wipes: [],
      combos: [
        { kind: 'infinite', cards: ['Kodama of the East Tree', 'Meloku the Clouded Mirror'], note: 'infinite flying tokens' },
        { kind: 'infinite', cards: ['Retreat to Coralhelm', 'Walking Atlas', 'Meloku the Clouded Mirror'], note: 'infinite tokens' }
      ],
      vs: { kill: ['Aesi, Tyrant of Gyre Strait', 'Meloku the Clouded Mirror'], hate: ['flyers'], wipeAt: 4, counter: ['commander', 'Omniscience'], note: 'Kill Aesi early; it has little removal, so pressure it in combat.' }
    },
    // ---------------- Bracket 3 ----------------
    'x9PjY9XdcU-f9giP4_oI0w': {
      cmdr: 'Giada, Font of Hope', arch: ['tribal', 'flyers', 'counters'], cmdrRole: 'engine', cmdrTurn: 2,
      plan: 'Giada on turn 2, then each Angel enters bigger. Fly over with a growing Angel army; Angel of Destiny can win outright.',
      win: ['flyers', 'alt-win', 'combat-wide'],
      key: ['Herald\'s Horn', 'Archangel of Thune', 'Righteous Valkyrie', 'Lyra Dawnbringer', 'Avacyn, Angel of Hope', 'Resplendent Angel', 'Angelic Accord', 'Luminarch Ascension', 'Sigarda\'s Splendor', 'Angel of Destiny'],
      protect: ['Giada, Font of Hope', 'Archangel of Thune', 'Avacyn, Angel of Hope', 'Herald\'s Horn'],
      finishers: ['Angel of Destiny', 'Archangel of Thune', 'Avacyn, Angel of Hope', 'Aetherflux Reservoir'],
      wipes: ['Wrath of God', 'Cleansing Nova'],
      combos: [{ kind: 'engine', cards: ['Archangel of Thune', 'Angel of Vitality'], note: 'lifegain grows the team' }],
      vs: { kill: ['Giada, Font of Hope', 'Archangel of Thune', 'Herald\'s Horn'], hate: ['flyers'], wipeAt: 4, counter: ['creature', 'commander'], note: 'Kill Giada on turn 2–3 or every Angel snowballs; hold a wipe for its flying army.' }
    },
    'Cj_pp4WH2EueTzNJcyOamQ': {
      cmdr: 'Bello, Bard of the Brambles', arch: ['enchantress', 'combat-wide'], cmdrRole: 'engine', cmdrTurn: 3,
      plan: 'Ramp into big enchantments; with Bello out they become 4/4 indestructible hasty attackers that draw cards. Extra combats finish.',
      win: ['combat-wide', 'combo'],
      key: ['Enchantress\'s Presence', 'Argothian Enchantress', 'Sanctum Weaver', 'Court of Bounty', 'Sandwurm Convergence', 'Garruk\'s Uprising', 'Akroma\'s Memorial', 'Aggravated Assault', 'Nature\'s Will', 'Overlord of the Hauntwoods'],
      protect: ['Bello, Bard of the Brambles', 'Aggravated Assault'],
      finishers: ['Aggravated Assault', 'Nature\'s Will', 'Akroma\'s Memorial', 'Gruul War Chant'],
      wipes: ['Blasphemous Act'],
      combos: [
        { kind: 'infinite', cards: ['Aggravated Assault', 'Nature\'s Will'], note: 'infinite combats' },
        { kind: 'infinite', cards: ['Sanctum Weaver', 'Aggravated Assault'], note: 'infinite combats' }
      ],
      vs: { kill: ['Bello, Bard of the Brambles', 'Aggravated Assault', 'Sanctum Weaver'], hate: ['enchantments'], wipeAt: 0, counter: ['commander', 'enchantment'], note: 'Its attackers are indestructible only on its turn — kill Bello and the army is just enchantments again.' }
    },
    'OYWg_0g7AkuzUapuc2DPpw': {
      cmdr: 'Sauron, the Dark Lord', arch: ['armies', 'control'], cmdrRole: 'engine', cmdrTurn: 6,
      plan: 'Protect Sauron with ward and counters; every opponent spell grows the Orc Army, which tempts the Ring and refills the hand. Win in combat with a huge Army.',
      win: ['combat-big', 'voltron'],
      key: ['The One Ring', 'Call of the Ring', 'Orcish Bowmasters', 'Mana Drain', 'Arcane Denial', 'Witch-king of Angmar', 'Mauhúr, Uruk-hai Captain', 'Saruman, the White Hand', 'Sword of Feast and Famine', 'Whispersilk Cloak'],
      protect: ['Sauron, the Dark Lord', 'The One Ring', 'Call of the Ring'],
      finishers: ['Sword of Feast and Famine', 'Shadowspear', 'Rogue\'s Passage', 'Whispersilk Cloak'],
      wipes: ['Toxic Deluge', 'Blasphemous Act', 'Feed the Swarm'],
      combos: [],
      vs: { kill: ['Sauron, the Dark Lord', 'The One Ring'], hate: ['tokens'], wipeAt: 3, counter: ['commander'], note: 'Ward makes targeting Sauron costly — use wipes and edicts; cast fewer, bigger spells because each one grows its Army.' }
    },
    // ---------------- Bracket 4 ----------------
    'oTndvxb8bkqLPK_kANUrkA': {
      cmdr: 'The Ur-Dragon', arch: ['tribal', 'ramp', 'flyers'], cmdrRole: 'value', cmdrTurn: 6,
      plan: 'Ramp fast with mana dorks and rocks, cast cheap Dragons (Eminence), then attack with Dragons to draw cards and drop more permanents. Terror of the Peaks and Dragon Tempest finish.',
      win: ['flyers', 'burn', 'combo'],
      key: ['Dragon Tempest', 'Terror of the Peaks', 'Goldspan Dragon', 'Miirym, Sentinel Wyrm', 'Old Gnawbone', 'Korvold, Fae-Cursed King', 'Scourge of Valkas', 'Lathliss, Dragon Queen', 'Smothering Tithe', 'The One Ring'],
      protect: ['Terror of the Peaks', 'Dragon Tempest', 'Miirym, Sentinel Wyrm', 'The Ur-Dragon'],
      finishers: ['Terror of the Peaks', 'Scourge of Valkas', 'Dragon Tempest', 'Ancient Gold Dragon'],
      wipes: ['Crux of Fate', 'Avatar\'s Wrath'],
      combos: [
        { kind: 'infinite', cards: ['Dragon Tempest', 'Ancient Gold Dragon'], note: 'near-infinite damage' },
        { kind: 'infinite', cards: ['Ganax, Astral Hunter', 'Draconic Visitor'], note: 'infinite Dragon tokens' },
        { kind: 'infinite', cards: ['Gleaming Splendor', 'Smothering Tithe', 'Goldspan Dragon'], note: 'infinite treasure' }
      ],
      vs: { kill: ['Terror of the Peaks', 'Dragon Tempest', 'Miirym, Sentinel Wyrm', 'Goldspan Dragon'], hate: ['flyers'], wipeAt: 3, counter: ['creature', 'Dragon Tempest'], note: 'Eminence works from the command zone, so killing The Ur-Dragon matters less than killing Terror of the Peaks and its ramp.' }
    },
    'VRMqj1czLkOKpOKurvGl7Q': {
      cmdr: 'The Gitrog Monster', arch: ['lands', 'graveyard', 'combo'], cmdrRole: 'engine', cmdrTurn: 4,
      plan: 'Put lands into the graveyard to draw cards with Gitrog; Dakmor Salvage plus a discard outlet draws the whole deck. Otherwise grind with deathtouch and big graveyard creatures.',
      win: ['combo', 'combat-big'],
      key: ['Dakmor Salvage', 'Putrid Imp', 'Noose Constrictor', 'Oblivion Crown', 'Crop Rotation', 'Golgari Grave-Troll', 'Grim Flayer', 'Gaea\'s Blessing', 'Sylvan Scrying', 'Turn the Earth'],
      protect: ['The Gitrog Monster', 'Putrid Imp'],
      finishers: ['Golgari Grave-Troll', 'Noose Constrictor', 'Drown in Filth'],
      wipes: ['Culling Ritual', 'Final Parting'],
      combos: [
        { kind: 'infinite', cards: ['The Gitrog Monster', 'Dakmor Salvage', 'Putrid Imp'], note: 'mill and draw the whole deck' },
        { kind: 'infinite', cards: ['The Gitrog Monster', 'Dakmor Salvage', 'Noose Constrictor'], note: 'mill the deck, huge Noose Constrictor' }
      ],
      vs: { kill: ['The Gitrog Monster', 'Putrid Imp', 'Noose Constrictor'], hate: ['graveyard'], wipeAt: 4, counter: ['commander'], note: 'Exile its graveyard and kill Gitrog before it finds Dakmor Salvage.' }
    },
    'hP0z_zZvxUO0IM02rQYptw': {
      cmdr: 'Brago, King Eternal', arch: ['blink', 'control', 'combo'], cmdrRole: 'engine', cmdrTurn: 4,
      plan: 'Protect Brago with counters and removal; each hit blinks value creatures and mana rocks. Deadeye Navigator + Peregrine Drake or Strionic Resonator go infinite.',
      win: ['combo', 'flyers', 'cmdr-damage'],
      key: ['Deadeye Navigator', 'Peregrine Drake', 'Strionic Resonator', 'Reflector Mage', 'Venser, Shaper Savant', 'Elesh Norn, Mother of Machines', 'Sailor of Means', 'Cyclonic Rift', 'Fierce Guardianship', 'Lightning Greaves'],
      protect: ['Brago, King Eternal', 'Deadeye Navigator', 'Elesh Norn, Mother of Machines'],
      finishers: ['Deadeye Navigator', 'Cyclonic Rift', 'Elesh Norn, Mother of Machines'],
      wipes: ['Cyclonic Rift'],
      combos: [
        { kind: 'infinite', cards: ['Peregrine Drake', 'Deadeye Navigator'], note: 'infinite mana and blinks' },
        { kind: 'infinite', cards: ['Brago, King Eternal', 'Strionic Resonator'], note: 'infinite blinks on combat damage' },
        { kind: 'infinite', cards: ['Cloud of Faeries', 'Deadeye Navigator'], note: 'infinite blinks' }
      ],
      vs: { kill: ['Brago, King Eternal', 'Deadeye Navigator'], hate: ['flyers'], wipeAt: 3, counter: ['commander', 'creature'], note: 'Block Brago with flyers or kill it; bait its counterspells (Swan Song, Fierce Guardianship) before the spell that matters.' }
    },
    // ---------------- Test decks ----------------
    'DeW5SJqHdU2xa-0ZeH__rw': {
      cmdr: 'Sythis, Harvest\'s Hand', arch: ['enchantress', 'voltron', 'tokens'], cmdrRole: 'engine', cmdrTurn: 2,
      plan: 'Cast enchantments to draw with Sythis; Sagas and Sigil of the Empty Throne make tokens, auras like Ethereal Armor turn one creature into a threat.',
      win: ['voltron', 'combat-wide'],
      key: ['Enchantress\'s Presence', 'Sigil of the Empty Throne', 'Setessan Champion', 'Archon of Sun\'s Grace', 'Ethereal Armor', 'Satyr Enchanter', 'Mesa Enchantress', 'Eidolon of Blossoms', 'Elspeth Conquers Death', 'Helm of the Gods'],
      protect: ['Sythis, Harvest\'s Hand', 'Sigil of the Empty Throne', 'Setessan Champion'],
      finishers: ['Ethereal Armor', 'Helm of the Gods', 'Sigil of the Empty Throne', 'Gavony Township'],
      wipes: ['Austere Command'],
      combos: [],
      vs: { kill: ['Sythis, Harvest\'s Hand', 'Setessan Champion', 'Sigil of the Empty Throne'], hate: ['enchantments'], wipeAt: 4, counter: ['enchantment'], note: 'Enchantment removal and wipes; kill the aura-loaded creature when it gets big.' }
    },
    'Wwp5vDCvMUyFCxOdAXcHzw': {
      cmdr: 'Kykar, Wind\'s Fury', arch: ['vehicles', 'tokens'], cmdrRole: 'enabler', cmdrTurn: 4,
      plan: 'Noncreature spells make Spirit tokens with Kykar; Spirits and pilots crew powerful Vehicles; Spirits also sacrifice for mana.',
      win: ['combat-big', 'flyers'],
      key: ['Sram, Senior Edificer', 'Smuggler\'s Copter', 'Heart of Kiran', 'Parhelion II', 'Shorikai, Genesis Engine', 'Kotori, Pilot Prodigy', 'Thopter Spy Network', 'Monastery Mentor', 'Sai, Master Thopterist', 'Reckoner Bankbuster'],
      protect: ['Kykar, Wind\'s Fury', 'Kotori, Pilot Prodigy', 'Parhelion II'],
      finishers: ['Parhelion II', 'Reaver Titan', 'Skysovereign, Consul Flagship', 'The Indomitable'],
      wipes: ['Supreme Verdict'],
      combos: [],
      vs: { kill: ['Kykar, Wind\'s Fury', 'Kotori, Pilot Prodigy', 'Monastery Mentor'], hate: ['artifacts', 'tokens'], wipeAt: 4, counter: ['artifact'], note: 'Vehicles survive creature wipes — use artifact removal and kill its crew.' }
    },
    'lMqnfWV5kUOfoQoP7bU4ng': {
      cmdr: 'Illuna, Apex of Wishes', arch: ['mutate', 'combat-big', 'ramp'], cmdrRole: 'threat', cmdrTurn: 5,
      plan: 'Ramp, then mutate onto non-Humans to stack abilities and cascade free permanents with Illuna; finish with trample and Craterhoof.',
      win: ['combat-big', 'flyers'],
      key: ['Gemrazer', 'Parcelbeast', 'Sea-Dasher Octopus', 'Vizier of the Menagerie', 'Beast Whisperer', 'Lurking Predators', 'The Great Henge', 'Rhythm of the Wild', 'Craterhoof Behemoth', 'Kodama of the East Tree'],
      protect: ['Illuna, Apex of Wishes', 'The Great Henge', 'Lurking Predators'],
      finishers: ['Craterhoof Behemoth', 'Overwhelming Stampede', 'Ghalta, Primal Hunger', 'Worldspine Wurm'],
      wipes: ['Blasphemous Act', 'Cyclonic Rift'],
      combos: [],
      vs: { kill: ['Illuna, Apex of Wishes', 'The Great Henge', 'Lurking Predators'], hate: [], wipeAt: 3, counter: ['creature', 'commander'], note: 'Bounce or exile the mutated pile (all of it leaves together); counter Craterhoof.' }
    },
    'A8efketpxU6xfkIcqebhuQ': {
      cmdr: 'Karumonix, the Rat King', arch: ['poison', 'tribal'], cmdrRole: 'engine', cmdrTurn: 3,
      plan: 'Karumonix gives every Rat toxic; go wide with Rats, poison opponents in combat and proliferate to 10.',
      win: ['poison', 'combat-wide'],
      key: ['Ichor Rats', 'Pack Rat', 'Rat Colony', 'Marrow-Gnawer', 'Thrumming Stone', 'Contagion Engine', 'Contagion Clasp', 'Vraska, Betrayal\'s Sting', 'Grave Pact', 'Staff of Compleation'],
      protect: ['Karumonix, the Rat King', 'Thrumming Stone', 'Pack Rat'],
      finishers: ['Contagion Engine', 'Vraska, Betrayal\'s Sting', 'Phyresis Outbreak', 'Drown in Ichor'],
      wipes: ['Mutilate'],
      combos: [],
      vs: { kill: ['Karumonix, the Rat King', 'Pack Rat', 'Thrumming Stone'], hate: [], wipeAt: 4, counter: ['commander'], note: 'Rats are small — a wipe resets it; poison counters stay, so watch the count.' }
    },
    '1kE5JHsiVU6j5vCjKmycDQ': {
      cmdr: 'Riku of Many Paths', arch: ['spellslinger', 'tokens'], cmdrRole: 'engine', cmdrTurn: 3,
      plan: 'Cast modal spells (Commands, Charms, Confluences); Riku turns each into extra cards, counters or Birds while spell-trigger creatures make tokens and burn.',
      win: ['combat-wide', 'burn', 'combo'],
      key: ['Arcane Bombardment', 'Storm-Kiln Artist', 'Archmage Emeritus', 'Veyran, Voice of Duality', 'Talrand, Sky Summoner', 'Young Pyromancer', 'Guttersnipe', 'Seedborn Muse', 'Prismari Command', 'Mystic Confluence'],
      protect: ['Riku of Many Paths', 'Arcane Bombardment', 'Veyran, Voice of Duality'],
      finishers: ['Guttersnipe', 'Fiery Confluence', 'Arcane Bombardment', 'Talrand, Sky Summoner'],
      wipes: ['Fiery Confluence', 'Hull Breach'],
      combos: [{ kind: 'infinite', cards: ['Arcane Bombardment', 'Prismari Command', 'Return the Favor'], note: 'infinite spell copies' }],
      vs: { kill: ['Riku of Many Paths', 'Veyran, Voice of Duality', 'Guttersnipe', 'Talrand, Sky Summoner'], hate: ['tokens'], wipeAt: 4, counter: ['enchantment'], note: 'Kill the spell-trigger creatures; it holds counterspells, so bait them.' }
    },
    'HE5NUaSdVk2DJ4NuXLnE6g': {
      cmdr: 'Satya, Aetherflux Genius', arch: ['energy', 'combat-big'], cmdrRole: 'engine', cmdrTurn: 4,
      plan: 'Satya attacks with haste and menace, copying the best attacker and making energy; spend energy on engines. Lightning Runner + Satya makes endless combats.',
      win: ['combat-big', 'combo'],
      key: ['Lightning Runner', 'Aetherworks Marvel', 'Gonti\'s Aether Heart', 'Decoction Module', 'Aethergeode Miner', 'Whirler Virtuoso', 'Angel of Invention', 'Goldspan Dragon', 'Professional Face-Breaker', 'Combustible Gearhulk'],
      protect: ['Satya, Aetherflux Genius', 'Lightning Runner'],
      finishers: ['Lightning Runner', 'Myr Battlesphere', 'Angel of Invention', 'Legion Loyalty'],
      wipes: ['Austere Command', 'Farewell'],
      combos: [
        { kind: 'infinite', cards: ['Satya, Aetherflux Genius', 'Lightning Runner'], note: 'infinite combats with copies' },
        { kind: 'infinite', cards: ['Lightning Runner', 'Stone Idol Generator'], note: 'infinite combats' }
      ],
      vs: { kill: ['Satya, Aetherflux Genius', 'Lightning Runner'], hate: ['artifacts'], wipeAt: 3, counter: ['commander'], note: 'Satya has haste — keep blockers or instant removal ready on its turn; kill Lightning Runner on sight.' }
    }
  };

  // Game-plan families, with what each one wants. Researched against the most-played commanders per bracket on
  // Moxfield (Oct 2026). Used to read an unknown commander and to know how to play each family.
  const ARCHETYPES = {
    'aristocrats': { wants: ['sacOutlet', 'deathDrain', 'tokens', 'recursion'], plan: 'make bodies, sacrifice them, drain on death', counter: 'exile instead of destroy; remove drain pieces and sac outlets' },
    'tokens': { wants: ['tokens', 'anthem', 'overrun'], plan: 'go wide then pump the team', counter: 'wipe when it is wide; one-sided blockers' },
    'tribal': { wants: ['lord', 'tribe', 'tribeDraw'], plan: 'creature-type synergies, lords, mass attacks', counter: 'kill lords and the commander; wipe' },
    'voltron': { wants: ['equipment', 'aura', 'protection', 'evasion'], plan: 'make one creature huge and evasive; win with commander damage', counter: 'edicts and exile; chump-block; kill it in response to equips' },
    'combat-big': { wants: ['bigCreature', 'trample', 'haste', 'ramp'], plan: 'ramp into large creatures and attack', counter: 'removal on the biggest threat; deathtouch blockers' },
    'combat-wide': { wants: ['tokens', 'anthem', 'extraCombat'], plan: 'many attackers, pump, extra combats', counter: 'wipes; fogs' },
    'flyers': { wants: ['flying', 'anthem'], plan: 'win in the air over ground blockers', counter: 'flying/reach blockers; wipes' },
    'spellslinger': { wants: ['cheapSpell', 'castTrigger', 'copy', 'draw'], plan: 'chain instants and sorceries for triggers', counter: 'kill the payoff creatures; counter the key spell' },
    'enchantress': { wants: ['enchantment', 'enchantDraw'], plan: 'enchantments draw cards and become threats', counter: 'enchantment removal and wipes' },
    'graveyard': { wants: ['selfMill', 'recursion', 'reanimate'], plan: 'fill the graveyard and replay from it', counter: 'graveyard exile' },
    'landfall': { wants: ['ramp', 'extraLand', 'landfallPayoff'], plan: 'play extra lands each turn for triggers', counter: 'kill the commander and payoffs early' },
    'lands': { wants: ['landToGy', 'extraLand', 'recursion'], plan: 'lands in graveyard draw cards and loop', counter: 'graveyard exile' },
    'ramp': { wants: ['ramp', 'bigSpell'], plan: 'out-mana the table, then cast huge things', counter: 'pressure early; counter the big spell' },
    'blink': { wants: ['etbValue', 'flicker'], plan: 'reuse enters-the-battlefield abilities', counter: 'exile the commander; counter Deadeye-style engines' },
    'control': { wants: ['counter', 'removal', 'wipe', 'draw'], plan: 'answer everything, win late', counter: 'bait counters; many cheap threats' },
    'drain': { wants: ['lifeLoss', 'damageEach'], plan: 'small life loss each turn adds up', counter: 'remove the enchantments; pressure early' },
    'poison': { wants: ['toxic', 'infect', 'proliferate'], plan: 'ten poison counters', counter: 'block poison creatures; wipes; watch the poison count' },
    'energy': { wants: ['energy', 'energyPayoff'], plan: 'build and spend energy for value and attacks', counter: 'kill the engines' },
    'mutate': { wants: ['mutate', 'nonHuman', 'trample'], plan: 'stack mutate triggers on one creature', counter: 'bounce/exile the pile' },
    'vehicles': { wants: ['vehicle', 'crew', 'pilot'], plan: 'crew big Vehicles', counter: 'artifact removal; kill the crew' },
    'monarch': { wants: ['monarch', 'flying', 'blockers'], plan: 'take and keep the monarch for cards', counter: 'hit the monarch in combat' },
    'counters': { wants: ['plusCounters', 'proliferate'], plan: '+1/+1 counters grow the team', counter: 'wipes; -X/-X' },
    'armies': { wants: ['amass', 'castTriggers'], plan: 'grow one Army token from opponents\' spells', counter: 'cast fewer spells; edicts' },
    'combo': { wants: ['tutor', 'comboPiece', 'protection'], plan: 'assemble a game-winning combination', counter: 'hold instant removal and counters for combo pieces' },
    'value': { wants: ['draw', 'etbValue'], plan: 'grind card advantage', counter: 'pressure' },
    'stax': { wants: ['tax', 'lock'], plan: 'slow the table', counter: 'artifact/enchantment removal' },
    'cascade': { wants: ['cascade', 'highMV'], plan: 'free spells from cascade', counter: 'counter the cascade spell' },
    'wheels': { wants: ['wheel', 'drawPunish'], plan: 'make everyone draw, punish draws', counter: 'remove the punishers' },
    'storm': { wants: ['ritual', 'cheapSpell', 'copy'], plan: 'many spells in one turn', counter: 'counter the finisher; tax effects' },
    'sagas': { wants: ['saga', 'enchantment'], plan: 'Saga chapters for value', counter: 'enchantment removal' },
    'theft': { wants: ['steal', 'copyOpp'], plan: 'use opponents\' cards', counter: 'exile your own key cards in response' },
    // Found in the research (Yuriko, Prosper, Magda, Isshin, Kaalia/Winota, Sisay/Jodah, Urza, Najeela, Ruric Thar, Rin and Seri…):
    'ninjas': { wants: ['evasion', 'ninjutsu', 'cheapCreature'], plan: 'connect with cheap evasive creatures, swap in ninjas', counter: 'block or kill evasive one-drops; keep blockers with flying' },
    'impulse': { wants: ['exileCast', 'treasure'], plan: 'exile top cards and play them for value', counter: 'pressure; it runs out of gas slowly' },
    'treasure': { wants: ['treasure', 'artifactSac'], plan: 'make Treasures, turn them into mana and damage', counter: 'artifact wipes' },
    'attackTriggers': { wants: ['attackTrigger', 'haste'], plan: 'every attack creates value (doubled triggers)', counter: 'kill the commander; fogs; deterrent blockers' },
    'cheat': { wants: ['bigCreature', 'cheatIntoPlay'], plan: 'put huge creatures onto the battlefield without casting them', counter: 'kill the commander on sight; exile the big creatures' },
    'legends': { wants: ['legendary', 'tutor'], plan: 'legendary toolbox and legend payoffs', counter: 'kill the commander' },
    'artifacts': { wants: ['artifact', 'artifactPayoff'], plan: 'artifact engines and constructs', counter: 'artifact removal and wipes' },
    'extraCombat': { wants: ['extraCombat', 'untap'], plan: 'take extra combat phases', counter: 'fogs; kill the extra-combat source' },
    'punisher': { wants: ['punish', 'tax'], plan: 'make opponents pay for playing (damage on noncreature spells)', counter: 'remove the punisher; play creatures' },
    'lifegain': { wants: ['lifegain', 'lifegainPayoff'], plan: 'gain life every turn and turn it into power or cards', counter: 'kill the payoff; lifegain hate' }
  };
  root.KT_AI_PROFILES = P;
  root.KT_AI_ARCHETYPES = ARCHETYPES;
  // Find a profile for a commander name (for opponents whose deck is a ready-made one).
  root.KT_AI_PROFILE_BY_CMDR = name => { for (const [id, p] of Object.entries(P)) if (p.cmdr === name) return Object.assign({ id }, p); return null; };
})(typeof window !== 'undefined' ? window : globalThis);
