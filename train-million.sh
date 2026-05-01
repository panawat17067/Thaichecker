#!/data/data/com.termux/files/usr/bin/bash
set -e
set -o pipefail

mkdir -p logs

TOTAL=1000000
BATCH=3000
DONE=0
ROUND=1

while [ "$DONE" -lt "$TOTAL" ]; do
  LEFT=$((TOTAL - DONE))

  if [ "$LEFT" -lt "$BATCH" ]; then
    GAMES=$LEFT
  else
    GAMES=$BATCH
  fi

  echo "=== Round $ROUND | games=$GAMES | done=$DONE/$TOTAL | $(date) ===" | tee -a logs/value-train-million.log

  VALUE_GAMES=$GAMES VALUE_DEPTH=2 VALUE_MAX_PLIES=180 VALUE_SAMPLE_EVERY=2 VALUE_LR=0.004 npm run train:value-model 2>&1 | tee -a logs/value-train-million.log

  DONE=$((DONE + GAMES))
  ROUND=$((ROUND + 1))

  echo "=== Finished | done=$DONE/$TOTAL | $(date) ===" | tee -a logs/value-train-million.log
done

echo "=== Done: 1,000,000 games completed | $(date) ===" | tee -a logs/value-train-million.log
