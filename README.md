# Mistwalkers 🐱🐶🐰🐦🐍🦋

A 3D city adventure where you play as a real animal (or small creature). You can explore at your own pace or step into the **black mist** to fight creatures from another world.

Runs in any modern browser on **PC and mobile**. It has a **fullscreen** button and touch controls.

## How to play
- Open `index.html` in a browser. It's a single file with no install and no server, so it also works from GitHub Pages.
- Pick a creature: **Cat, Dog, Rabbit, Sparrow, Snake or Butterfly**. Each has 4 coat colours.
- Live like the real animal: eat the right food, nap in the sun, sneak, dig, swim, fly, make friends.
- Black mist shows up in a few places around the city. Walk close and you'll be asked whether you want to challenge it. Saying yes takes you into a **Rift** with waves of monsters, plus a boss at tier 5.
- Fighting is optional. You can ignore the mist and keep exploring.

### Controls (PC)
| Action | Key |
|---|---|
| Move / camera | `WASD` / mouse (click the game to lock the mouse), wheel = zoom |
| Jump · fly · rise | `Space` (cat: **hold** to charge a high jump · bird: press again in the air to fly) |
| Sprint | `Shift` |
| Interact / eat | `E` |
| Instinct (species ability) | `F` |
| Sit / nap / dive | `X` |
| Call (meow, bark…) | `Left click` in the city, or `G` |
| Rift attacks | `Left click`, `Right click` · skills `1 2 3` · ultimates `Q R` |
| Rift defence | dodge `Shift`/`C` · guard (hold) `F` · parry (tap) `E` or middle mouse |
| Map · Abilities · Journal · Pause | `M` · `I` · `L` · `Esc` |
| Toggle 3D / 2.5D camera | `V` |

### Controls (mobile)
Left side of the screen is the joystick (push it to the edge to sprint). Drag on the right side to look around. On‑screen buttons handle jump, interact, instinct, nap and call. In the Rift, attack, skill, ultimate and dodge buttons appear. Tap **⛶** to go fullscreen. On iPhone, use *Share → Add to Home Screen* instead.

## What's in it
- **City map** (~400 m × 400 m) with districts: Central Park (with pond and island), Old Town (rooftop routes and fire escapes), Downtown towers, Fountain Plaza, Market Street, Café Corner, Maple Residences (yards and fences), Community Garden, Schoolyard, Construction Yard with a crane, and Harbor Docks with piers and boats.
- **Living world**: traffic that brakes and honks, pedestrians, market vendors, fishermen, a lady feeding pigeons, kids who play fetch, plus pigeons, ducks, squirrels, mice, stray cats and butterflies. Full day/night cycle with lit windows and street lamps.
- **Realistic species behaviour**:
  - Cats charge their jumps (with the butt wiggle), climb fire escapes to the roofs, see in the dark, hate water, knock cups off tables, and can't digest milk.
  - Dogs sniff out trails, dig, swim, play fetch, and get sick from chocolate.
  - Rabbits hop, eat greens, listen with their big ears, and do binkies.
  - Birds fly, perch on lamps, sing and bathe in the fountain.
  - Snakes slither along their own path, strike, camouflage and swallow eggs.
  - Butterflies sip nectar, puddle for minerals and ride updrafts.
- **Needs**: hunger, energy and mood. Good food, naps, petting and play make your creature happy (+10% damage in the Rift). Bad food has real consequences.
- **Habits journal**: 5 real‑life habits per species. They give XP, and completing all of them gives a skill point.
- **Combat**: 2 normal attacks, up to 3 skills and 2 ultimates per creature (8 abilities each, 48 total). You start with 1 normal attack, 1 skill and 1 ultimate. Unlock the rest with skill points from levelling up (fight in the mist), the 10 hidden **Echo Shards** around the city, and completing habits.
- **Defensive combat**:
  - **Dodge** gives a short invincible dash. Dodge just before a hit for a **Perfect Dodge**: slow motion plus a damage buff.
  - **Guard** (hold) blocks attacks you're facing but drains energy. Run out and your guard breaks.
  - **Perfect Guard** means starting your guard right as a hit lands. You take no damage, get energy back, and the attacker flinches.
  - **Parry** (tap) has a tight timing window. It staggers melee attackers (they take +50% damage), reflects projectiles, and gives you a Counter buff. A missed parry leaves you open.
  - Enemies flash **gold** before attacks you can parry or guard, and **red** before unblockable ones you have to dodge.
  - Perfect parries, guards and dodges give bonus XP, and so does clearing a rift without being hit.
- **Rifts**: 8 mist zones (tiers 1–5) with 5 monster types that are neither animal nor human. Enemy attacks are telegraphed, and there's a multi‑phase boss called *The Unwoven*.
- Progress auto-saves in the browser, separately for each creature.

## Development
```bash
npm install
npm run build      # bundles src/ → index.html (minified)
npm run dev        # same, unminified
```
Source is in `src/` (Three.js, no other runtime dependencies). `web/index.src.html` is the page template with the UI styles.
