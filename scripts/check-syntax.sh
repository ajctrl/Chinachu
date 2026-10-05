#!/bin/bash

set -euo pipefail

while IFS= read -r -d '' file; do
  if [[ -f "$file" ]]; then
    node --check "$file"
  fi
done < <(git ls-files --cached --others --exclude-standard -z '*.js' '*.cjs' ':!:web/lib/**')

bash -n chinachu
