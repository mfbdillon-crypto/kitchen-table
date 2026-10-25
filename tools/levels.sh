#!/bin/bash
# usage: levels.sh L1 L2 ; tallies wins of L1 vs L2 over deck pairs, both seat orders
L1=$1; L2=$2; w1=0; w2=0; d=0
for pair in "6,3" "0,1" "2,4" "5,7" "8,9" "10,11" "12,13" "14,15" "16,17"; do
  a=${pair%,*}; b=${pair#*,}
  for order in "$a,$b $L1,$L2 A" "$b,$a $L2,$L1 B"; do
    set -- $order
    out=$(QUIET=1 timeout 300 node test/ai_sim.js $1 $2 40 $RANDOM 3 2>&1 | grep GAME)
    while read -r line; do
      win=$(echo "$line" | sed -n 's/.*winner \([A-Z][A-Z]\);.*/\1/p')
      lvl=${win:1:1}
      if [ -z "$win" ]; then d=$((d+1)); elif [ "$lvl" == "${L1:0:1}" ] || [ "$lvl" == "$(echo ${L1:0:1} | tr a-z A-Z)" ]; then w1=$((w1+1)); else w2=$((w2+1)); fi
    done <<< "$out"
  done
done
echo "$L1 $w1 — $L2 $w2 — no winner $d"
