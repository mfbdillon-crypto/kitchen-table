global.window = global; require('../site/scry.js'); const P = window.Scry.parseDeckFile;
const txt = `// COMMANDER
1 Niv-Mizzet, Visionary (FDN) 350

1 Counterspell (DSC) 114
1 Jace, Ingenious Mind-Mage (XLN) 280 *F*
1 Delver of Secrets // Insectile Aberration (ISD) 51
4 Island (FDN) 279
1 Sol Ring (PLST) C21-263 *E*
2 Lightning Bolt

// SIDEBOARD
1 Negate (M19) 69

// MAYBEBOARD
1 Opt (XLN) 65`;
const r = P(txt); console.log(r.map(x => `${x.qty}|${x.name}|${x.set}|${x.num}|${x.cmdr ? 'CMDR' : ''}`).join('\n'));
const arena = `Commander
1 Alesha, Who Smiles at Death (FRF) 90

Deck
1 Sol Ring (C21) 263
30 Plains`;
console.log('--arena--\n' + P(arena).map(x => `${x.qty}|${x.name}|${x.set}|${x.num}|${x.cmdr ? 'CMDR' : ''}`).join('\n'));
const csv = `Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency
Alesha,deck,"Alesha, Who Smiles at Death",frf,Fate Reforged,90,normal,rare,1,123,8b3a5d4f-0000-4000-9000-000000000001,0.5,false,false,near_mint,en,USD
Alesha,deck,Plains,fdn,Foundations,272,foil,common,12,124,,0.1,false,false,near_mint,ja,USD`;
console.log('--csv--\n' + P(csv).map(x => `${x.qty}|${x.name}|${x.set}|${x.num}|${x.id}`).join('\n'));
console.log('--no qty--\n' + P(`1 Sol Ring\nCommand Tower\nForest\n// SIDEBOARD\nNegate`).map(x => `${x.qty}|${x.name}|${x.cmdr}`).join('\n'));
console.log('--sections--\n' + P(`Commander (1)\n1 Alesha, Who Smiles at Death\n\nCreatures (2)\n1 Creature 1\n1 Creature 2\nLands\n10 Forest`).map(x => `${x.qty}|${x.name}|${x.cmdr?'CMDR':''}`).join('\n'));
