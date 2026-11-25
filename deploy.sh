#!/bin/sh
# deploy.sh : THE ONE WAY TO DEPLOY Free Fall Frank (server.js, "SAFE BUILDS"). Run it from anywhere: ./deploy.sh
# It deploys what is in this folder, and only after everything that can be known beforehand says yes:
#   0. (the first time only) the client of the release that is live is fetched from the live site, to be tested against
#   1. npm test on SQLite: the levels (sim, forks, fair, audio), the kept levels and worlds (fixtures), the server,
#      safe builds (the build id, the keys, the money, the saves, the service worker, the check), the contract with
#      the page of the release before, and, when Playwright is there (PLAYWRIGHT_PATH or NODE_PATH), the safe reload,
#      the outbox and the saves in a browser. Then the same again on a real Postgres when TEST_DATABASE_URL names one
#      (each test in a schema of its own).
#   2. the build id, and the build that was deployed last (deployed.txt: this folder is not a git repository)
#   3. fly deploy --ha=false. Fly builds the image and, BEFORE it replaces the running machine, runs
#      "node server.js --check" in a machine of its own against the real database (fly.toml, release_command): the
#      schema, every table and statement, every made level. If that fails nothing is replaced and the old build
#      keeps running.
#   4. the live site is asked: /healthz, /, /play, /about, /sw.js, /api/me, /api/world?id=rock, that it now serves
#      this build, and that /worlds.js is still not served
#   5. only then it is written down as deployed: deployed.txt, deployed.fly.toml (the fly.toml a rollback to this
#      release needs), the client as it went out (test/fixtures/deployed: the next release is tested against this
#      one's page and builder), and what this release's page relies on (test/contract.json).
#      If 4 fails: it says so, loudly, with how to go back.
#   ./deploy.sh --dry   does 1 and 2 and stops (nothing is deployed, nothing is written down as deployed)
set -eu
APP=free-fall-frank
SITE=https://freefallfrank.com
cd "$(dirname "$0")"
say() { printf '\n== %s\n' "$*"; }
stop() { printf '\nNOT DEPLOYED: %s\n' "$*" >&2; exit 1; }

FLY=$(command -v fly || command -v flyctl || true)
[ -n "$FLY" ] || [ "${1:-}" = "--dry" ] || stop "the fly command is not installed here."
# the build id, and the files a browser is given (server.js CLIENT)
INFO=$(node -e "process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'fff-build-')); delete process.env.DATABASE_URL; delete process.env.CLIENT_DIR; process.env.NODE_NO_WARNINGS = '1'; const S = require('./server.js'); console.log(S.build()); console.log(S.CLIENT.join(' ')); process.exit(0);" 2>/dev/null)
BUILD=$(printf '%s\n' "$INFO" | sed -n 1p)
CLIENT=$(printf '%s\n' "$INFO" | sed -n 2p)
[ -n "$BUILD" ] && [ -n "$CLIENT" ] || stop "the build id could not be worked out."

# 0 (the first deploy by this script only) The release that is live was made before there were builds, and nothing
# of it is kept here: its client is fetched from the live site as it is, so that the tests below play ITS page and
# use ITS builder against this server (test/fixtures/deployed). From then on step 5 keeps each release as it goes out.
if [ ! -f deployed.txt ] && [ ! -d test/fixtures/deployed ]; then
  say "the first deploy by this script: fetching the client that is live now, to test this release against it"
  for f in $CLIENT; do
    mkdir -p "test/fixtures/deployed/$(dirname "$f")"
    curl -fsS --max-time 40 -o "test/fixtures/deployed/$f" "$SITE/$f" 2>/dev/null || rm -f "test/fixtures/deployed/$f"
  done
  if [ -f test/fixtures/deployed/index.html ] && [ -f test/fixtures/deployed/core.js ] && [ -f test/fixtures/deployed/game.js ]; then echo "kept in test/fixtures/deployed"
  else rm -rf test/fixtures/deployed; echo "!! it could not be fetched: this release is NOT tested against the page that is live (the tests say so in a line each)."; fi
fi

# 1
LOG=$(mktemp)
say "the tests, on SQLite"
if (unset TEST_DATABASE_URL; npm test) >"$LOG" 2>&1; then grep -E '^(OK|SKIPPED)' "$LOG" || true; else cat "$LOG"; stop "the tests failed (above)."; fi
SKIPPED=$(grep -c '^SKIPPED ' "$LOG" || true)
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  say "the tests again, on the Postgres named by TEST_DATABASE_URL"
  if npm test >"$LOG" 2>&1; then grep -E '^(OK|SKIPPED)' "$LOG" | grep -E 'server|safe|contract|check \(the command|browser' || true; else cat "$LOG"; stop "the tests failed on Postgres (above)."; fi
else
  echo "(TEST_DATABASE_URL is not set: not run on a Postgres here. The check that runs before the swap, in step 3, is what meets the real one.)"
fi
[ "$SKIPPED" = "0" ] || printf '\n!! %s browser check(s) were SKIPPED: Playwright is not here. The safe reload, the outbox and the saves were NOT run in a browser. Set PLAYWRIGHT_PATH or NODE_PATH to run them.\n' "$SKIPPED"

# 2
say "build $BUILD"
if [ -f deployed.txt ]; then
  LAST=$(tail -n 1 deployed.txt)
  echo "deployed last: $LAST"
  case "$LAST" in "$BUILD "*) echo "(the client is the same build as the one that is deployed: only the server's own files can differ)";; esac
else
  echo "(there is no deployed.txt yet: this is the first deploy by this script. The live site is the release from before there were builds.)"
fi
if [ "${1:-}" = "--dry" ]; then say "--dry: stopping here. Nothing was deployed."; exit 0; fi

# 3
say "fly deploy (the release check runs first; the old build keeps running if it fails)"
"$FLY" deploy --ha=false -a "$APP" || stop "fly deploy did not finish. If it stopped at the release command, the check's own lines above say exactly what is wrong, and the machine that was running is still running the old build."

# 4
say "asking the live site"
BAD=""
# (the machine may be waking, or still coming up: each address is asked for up to about a minute)
ask() {
  n=0
  while [ "$n" -lt 12 ]; do
    if BODY=$(curl -fsS --max-time 20 "$SITE$1" 2>/dev/null) && printf '%s' "$BODY" | grep -qF -- "$2"; then echo "ok    $1"; return 0; fi
    n=$((n + 1)); sleep 5
  done
  echo "FAIL  $1 (wanted to see: $2)"; BAD="$BAD $1"
}
# an address that must NOT be served: the paid level's stretches are only ever handed out by /api/world
gone() {
  n=0
  while [ "$n" -lt 12 ]; do
    CODE=$(curl -sS -o /dev/null --max-time 20 -w '%{http_code}' "$SITE$1" 2>/dev/null || true)
    if [ "$CODE" = "404" ]; then echo "ok    $1 is not served"; return 0; fi
    case "$CODE" in 2*) echo "FAIL  $1 IS SERVED (it answered $CODE)"; BAD="$BAD $1"; return 0;; esac
    n=$((n + 1)); sleep 5
  done
  echo "FAIL  $1 (wanted a 404, got: $CODE)"; BAD="$BAD $1"
}
ask /healthz "\"build\":\"$BUILD\""
ask / "<title>"
ask /play "FFF_BUILD = \"$BUILD\""
ask /about "<title>"
ask /sw.js "const BUILD = '$BUILD'"
ask /api/me "\"build\":\"$BUILD\""
ask "/api/world?id=rock" "\"taste\":true"
gone /worlds.js
if [ -n "$BAD" ]; then
  cat >&2 <<EOF

################################################################################
##  THE DEPLOY WENT OUT AND THE LIVE SITE IS NOT RIGHT:$BAD
##  It has NOT been written down as deployed. Players may be affected NOW.
##
##  TO GO BACK to the release before (the database needs nothing: the schema only grows):
##    1. find its image:    fly releases -a $APP --image
##    2. deploy that image, WITH THAT RELEASE'S OWN fly.toml, which is kept here as deployed.fly.toml:
##                          fly deploy --ha=false -a $APP -c deployed.fly.toml --image <THE IMAGE FROM 1>
##  The -c matters: an image from before "node server.js --check" existed would START A SERVER when asked to run
##  it as the release command, and the rollback would hang. deployed.fly.toml is the fly.toml of the last release
##  this script saw live (for the release from before there were builds: the one with no [deploy] in it).
##
##  Then look:  fly logs -a $APP     fly status -a $APP     curl -i $SITE/healthz
################################################################################
EOF
  exit 1
fi

# 5
printf '%s %s\n' "$BUILD" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> deployed.txt
cp fly.toml deployed.fly.toml
rm -rf test/fixtures/deployed
for f in $CLIENT; do mkdir -p "test/fixtures/deployed/$(dirname "$f")"; cp "$f" "test/fixtures/deployed/$f"; done
(unset TEST_DATABASE_URL; node test/contract.cjs --accept) >"$LOG" 2>&1 && grep -E '^OK' "$LOG" || { cat "$LOG"; echo "!! test/contract.json was NOT brought up to this release (above). Run: node test/contract.cjs --accept"; }
say "DEPLOYED: build $BUILD is live and answering. It is written down in deployed.txt."
echo "Pages that were open are told by their next answer from the server, and reload themselves at a moment that costs the player nothing."
