# Odyssey — Exercise Library Seed

**Purpose.** Seed list for the Odyssey exercise library, grouped by movement pattern. Free-weight-first, gym-equipped, intermediate-to-advanced.

**How to use.** Review and edit this file directly, then hand to Claude Code to seed the `exercises` table. Each line under a category heading is one exercise. Format is `Name SETSxREPS METRIC` (e.g. `BB Bench Press 3x8 KG`). Metric `-` means no external load (bodyweight); `KG` = load; `20m` = distance; `30sec` = time. Lines tagged `(machine)` are machine-based; everything else is free-weight, bodyweight, or cable.

---

## Abbreviation key

| Abbrev | Meaning |
|---|---|
| BB | Barbell |
| DB | Dumbbell |
| SL | Single leg |
| SA | Single arm |
| KB | Kettlebell |
| RDL | Romanian deadlift |
| GHD | Glute-ham developer |

---

## Implementation notes for Claude Code (read before seeding)

1. **`movement_pattern` is single-select.** Every exercise belongs to exactly one of the eight patterns below. No exercise carries two patterns.
2. **The eight patterns are this practitioner's own taxonomy, and are practitioner-configurable.** Six cover compound and bigger single-limb work (Push, Pull, Hinge, Squat, Carry, Core). **Accessory** and **Plyometrics** catch everything that is *not* compound or a bigger single-limb movement — isolation work and jump/throw work respectively.
3. **Exercise tags are a separate layer from movement pattern.** The finer cut (rehab, prehab, athlete vs lifestyle, etc.) lives in the exercise-tags field, not the movement-pattern field. Both fields are practitioner-configurable.
4. **Machine items are tagged `(machine)` inline.**

---

## Push

- BB Bench Press 3x8 KG
- BB Incline Bench Press 3x8 KG
- BB Decline Bench Press 3x8 KG
- BB Close-Grip Bench Press 3x8 KG
- DB Bench Press 3x8 KG
- DB Incline Bench Press 3x8 KG
- DB Decline Bench Press 3x8 KG
- DB Floor Press 3x8 KG
- DB Neutral-Grip Bench Press 3x8 KG
- SA DB Bench Press 3x8 KG
- BB Shoulder Press (standing) 3x8 KG
- BB Push Press 3x8 KG
- BB Z Press 3x8 KG
- DB Shoulder Press (standing) 3x8 KG
- DB Seated Shoulder Press 3x8 KG
- DB Arnold Press 3x8 KG
- SA DB Shoulder Press 3x8 KG
- SA DB Push Press 3x8 KG
- Half-Kneeling SA DB Shoulder Press 3x8 KG
- Landmine Press 3x8 KG
- SA Landmine Press 3x8 KG
- Half-Kneeling SA Landmine Press 3x8 KG
- Landmine Push Press 3x8 KG
- Push-up 3x8 -
- Incline Push-up 3x8 -
- Wall Push-up 3x8 -
- Push-up Sliderz 3x8 -
- Weighted Push-Up 3x8 KG
- Weighted Dip (parallel bar) 3x12 KG
- Ring DipS 3X12
- Machine Chest Press (machine) 3x12 KG
- Hammer Strength Incline Press (machine) 3x12 KG
- Machine Shoulder Press (machine) 3x12 KG

---

## Pull

- Pull-Up 3x8 -
- Chin-Up 3x8 -
- Neutral-Grip Pull-Up 3x8 KG
- Weighted Pull-Up 3x8 KG
- Weighted Chin-Up 3x8 KG
- Weighted Neutral-Grip Pull-Up 3x8 KG
- SA Half-Kneeling Lat Pulldown 3x8 KG
- Straight-Arm Pulldown (cable) 3x12 KG
- BB Bent-Over Row (pronated) 3x8 KG
- BB Pendlay Row 3x8 KG
- BB Yates Row (underhand) 3x8 KG
- BB Seal Row 3x8 KG
- Landmine T-Bar Row 3x8 KG
- DB Bent-Over Row (two-arm) 3x8 KG
- SA DB Row (bench-supported) 3x8 KG
- Chest-Supported DB Row (incline) 3x8 KG
- DB Chest-Supported Rear-Delt Row 3x8 KG
- SA Landmine Row 3x8 KG
- Seated Cable Row (neutral grip) 3x8 KG
- Wide-Grip Seated Cable Row 3x8 KG
- SA Half-Kneeling Cable Row 3x8 KG
- Standing SA Row 3x8 KG
- Inverted Row 3x8 -
- Weighted Inverted Row 3x8 KG
- Hammer Strength Iso-Lateral Row (machine) 3x8 KG
- Machine High Row (machine) 3x8 KG

---

## Hinge

- BB Conventional Deadlift 3x8 KG
- BB Sumo Deadlift 3x8 KG
- BB Deficit Deadlift 3x8 KG
- BB Rack Pull 3x8 KG
- Trap Bar RDL 3x8 KG
- B-stance Trap Bar RDL 3x8 KG
- DB RDL 3x8 KG
- Landmine RDL 3x8 KG
- SL BB RDL 3x8 KG
- B-Stance DB RDL 3x8 KG
- B-Stance BB RDL 3x8 KG
- BB Good Morning 3x8 KG
- BB Seated Good Morning 3x8 KG
- BB Hip Thrust 3x8 KG
- SL Hip Thrust 3x8 KG
- B-Stance Hip Thrust 3x8 KG
- BB Glute Bridge 3x8 KG
- Glute-Ham Raise — GHD (machine) 3x8 KG

---

## Squat

- BB Back Squat (high-bar) 3x8 KG
- BB Low-Bar Back Squat 3x8 KG
- BB Front Squat 3x8 KG
- BB Box Squat 3x8 KG
- BB Pause Squat 3x8 KG
- BB Zercher Squat 3x8 KG
- BB Overhead Squat 3x8 KG
- Safety Bar Squat 3x8 KG
- Goblet Squat 3x8 KG
- DB Front Squat 3x8 KG
- Heels-Elevated Goblet Squat 3x8 KG
- Landmine Goblet Squat 3x8 KG
- Landmine Hack Squat 3x8 KG
- DB Split Squat 3x8 KG
- BB Split Squat 3x8 KG
- DB Bulgarian Split Squat 3x8 KG
- BB Bulgarian Split Squat 3x8 KG
- Front-Foot-Elevated DB Split Squat 3x8 KG
- DB Reverse Lunge 3x8 KG
- BB Reverse Lunge 3x8 KG
- Deficit DB Reverse Lunge 3x8 KG
- DB Walking Lunge 3x8 KG
- DB Forward Lunge 3x8 KG
- DB Step-Up 3x8 KG
- BB Step-Up 3x8 KG
- SL Lateral Step-Up 3x8 KG
- KB SL Squat 3x8 KG
- DB Skater Squat 3x8 KG
- Leg Press (45°) (machine) 3x8 KG
- Hack Squat (machine) 3x8 KG

---

## Carry

- Farmer's Carry (DB) 3x20m
- Farmer's Carry (trap bar) 3x20m
- Farmer's Carry (handles) 3x20m
- SA Suitcase Carry (DB) 3x20m
- SA Suitcase Carry (KB) 3x20m
- BB Overhead Carry 3x20m
- DB SA Overhead Carry 3x20m
- SA Bottoms-Up KB Carry 3x20m
- Zercher Carry (BB) 3x20m
- Bear-Hug Sandbag Carry 3x20m
- Sled Push 3x20m
- Forward Sled Drag 3x20m
- Backward Sled Drag (quad) 3x20m

---

## Core

- Ab Wheel Rollout (from knees) 3x6 -
- Weighted Plank 3x30sec
- Plank 3x30sec
- Hollow-Body Hold 3x30sec
- Weighted Hollow-Body Hold 3x30sec
- Weighted Dead Bug 3x16 KG
- Banded Dead bug 3x16 KG
- Banded Dead bug iso 3x30sec
- Bear Crawl Isometric 3x30sec
- Bear Crawl 3x12 -
- Pallof Press (cable) 3x12 KG
- Banded Pallof Press 3x12 KG
- Kneeling Pallof Press (cable) 3x12 KG
- Cable Woodchop (high-to-low) 3x12 KG
- Cable Reverse Woodchop (low-to-high) 3x12 KG
- Landmine Rotation (180) 3x16 KG
- Landmine Anti-Rotation (rainbow) 3x16 KG
- Kneeling Landmine Anti-Rotation (rainbow) 3x16 KG
- Russian Twist 3x20 -
- Side Plank on Knees 3x30sec
- Side Plank 3x30sec
- Side Plank w Knee Flexion 3x30sec
- Side Plank Dips 3x12 -
- Side Plank w Leg Lift (Isometric) 3x30sec
- Side Plank w Leg Lifts 3x12 -
- GHD Oblique Hold 3x30sec
- GHD Oblique Crunches 3x12 KG
- 45 Degree Oblique Hold 3x30sec
- 45 Degree Oblique Crunches 3x12 KG
- Turkish Get-Up (KB) 3x10 KG
- Stir-the-Pot (ball) 3x20 -
- Machine Crunch (machine) 3x20 KG

---

## Accessory

- BB Bicep Curl 3x12 KG
- DB Incline Curl 3x12 KG
- DB Concentration Curl 3x12 KG
- DB Zottman Curl 3x12 KG
- Cable Curl 3x12 KG
- Cable Hammer Curl (rope) 3x12 KG
- Preacher Curl (machine) 3x12 KG
- BB Skull Crusher 3x12 KG
- DB Skull Crusher 3x12 KG
- DB Overhead Triceps Extension (two-hand) 3x12 KG
- SA DB Overhead Extension 3x12 KG
- Overhead Cable Triceps Extension 3x12 KG
- Cable Triceps Kickback 3x12 KG
- DB Triceps Kickback 3x12 KG
- DB Lateral Raise 3x12 KG
- Cable Lateral Raise 3x12 KG
- SA Cable Lateral Raise 3x12 KG
- DB Front Raise 3x12 KG
- DB Rear-Delt Fly 3x12 KG
- Cable Rear-Delt Fly 3x12 KG
- Incline DB Y-Raise 3x12 KG
- Incline DB T-Raise 3x12 KG
- Incline DB I-Raise 3x12 KG
- Incline DB W-Raise 3x12 KG
- Half Cubans 3x12 KG
- Full Cubans 3x12 KG
- DB Upright Row 3x12 KG
- BB Shrug 3x12 KG
- DB Shrug 3x12 KG
- Trap Bar Shrug 3x12 KG
- Cable Face Pull 3x12 KG
- DB Fly (flat) 3x12 KG
- DB Incline Fly 3x12 KG
- Mid Cable Fly 3x12 KG
- Low-to-High Cable Fly 3x12 KG
- High-to-Low Cable Fly 3x12 KG
- Pec Deck (machine) 3x12 KG
- Leg Extension (machine) 3x12 KG
- SL Leg Extension (machine) 3x12 KG
- Lying Leg Curl (machine) 3x8 KG
- Seated Leg Curl (machine) 3x8 KG
- Nordic Hamstring Curl 3x8 -
- Weighted 45° Back Extension 3x8 KG
- KB Swing (heavy) 3x8 KG
- Seated Calf Raise (machine) 3x12 KG
- BB Wrist Curl 3x12 KG
- BB Reverse Wrist Curl 3x12 KG
- DB Wrist Extension Iso 3x45sec
- DB Wrist Extension (Eccentric) 4x5 KG
- DB Wrist Flexion Iso 3x45sec
- DB Wrist Flexion (Eccentric) 4x5 KG
- Finger Plate Holds 1x30sec
- DB Supination (Eccentric) 4x5 KG
- DB Pronation (Eccentric) 4x5 KG

---

## Plyometrics

- Box Jump 4x5 -
- Seated Box Jump (concentric-only) 4x5 -
- Counter Movement Jump 4x5 -
- Drop Landing 4x5 -
- Drop Jump to Box 4x5 -
- Standing Broad Jump 4x5 -
- Broad Jump (Continuous) 4x3 -
- Continuous Hurdle Hop 4x3 -
- Tuck Jump 3x10 -
- DB Jump Squat 4x5 KG
- DB Jump Squat (Eccentric Only) 4x5 KG
- Trap Bar Jump 4x5 KG
- DL Pogos 4x20 -
- SL Pogo 4x20 -
- SL Box Jump 4x5 -
- SL Broad Jump 4x5 -
- Alternating Bound 3x16 -
- SL Lateral Bound (skater) 3x16 -
- SL Continuous Hop (distance) 4x3 -
- Depth Jump to Broad Jump 4x3 -
- Plyo Push-Up 4x5 -
- Clap Push-Up 4x5 -
- Band Assisted Plyo Push-up 4x5 -
- Depth-Drop Push-Up 4x5 -
- Med Ball Chest Pass 4x5 KG
- Med Ball Overhead Throw 4x5 KG
- Med Ball Slam 4x5 KG
- Med Ball Rotational Throw 4x5 KG
- Med Ball Scoop Toss 4x5 KG
- SA Med Ball Throw 4x5 KG

---

*End of seed — review, edit, then hand to Claude Code.*
