#!/bin/bash
# 4-player games across all 18 decks, three seeds; logs per game
cd /home/claude/mtg
for seed in 31 32 33; do
  for grp in "0,5,10,15" "1,6,11,16" "2,7,12,17" "3,8,13,4" "9,14,0,7"; do
    LOG=1 timeout 600 node test/ai_sim.js $grp hard,normal,easy,normal 40 $seed 1 > /tmp/claude-0/sw2/g_${grp//,/-}_$seed.txt 2>&1
  done
done
echo done
