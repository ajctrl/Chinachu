#!/bin/bash

set -euo pipefail

while IFS= read -r file; do
  node --check "$file"
done < <(git ls-files '*.js' ':!:web/lib/**')

bash -n chinachu
