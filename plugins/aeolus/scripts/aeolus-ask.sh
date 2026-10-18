#!/usr/bin/env bash
# Asks the ship's owner a question as the ship protocol says (decisions 0038,
# 0045), or withdraws or replaces one, so a session writes no JSON by hand.
# whoami names the owner's ship (argo when argo owns the ship; argo by name
# for a ship with no owner). A withdrawal or replacement goes to the ship the
# question asked, as the folder's question file kept it, though the owner
# changed since. Sends through aeolus-fleet.sh, which adds the crew token, and
# prints what it prints.
#
#   aeolus-ask.sh ask <question> [--model <model>]
#   aeolus-ask.sh withdraw <questionId> [--model <model>]
#   aeolus-ask.sh replace <questionId> <question> [--model <model>]
#
#   <question>: --title <title> [--context <context>]
#               --option <label> <detail> (once per option, numbered from 1 in order)
#               --pick <option number> <why>
#
# A question gets a new uuid; the script says it, to withdraw or replace the
# question by. The answer arrives as a reply to the question's message.
#
# Exit codes: 2 when the input is not a question or names a question this folder
# did not ask, else those of aeolus-fleet.sh.
set -uo pipefail
. "$(dirname "$0")/aeolus-lib.sh"

QUESTION_CONTENT_TYPE='application/vnd.aeolus.question+json'
WITHDRAWAL_CONTENT_TYPE='application/vnd.aeolus.question-withdrawal+json'
REPLACEMENT_CONTENT_TYPE='application/vnd.aeolus.question-replacement+json'

usage() {
  [ -n "${1:-}" ] && echo "aeolus: $1" >&2
  echo "usage: aeolus-ask.sh ask --title <title> [--context <context>] --option <label> <detail>... --pick <option number> <why> [--model <model>]" >&2
  echo "       aeolus-ask.sh withdraw <questionId> [--model <model>]" >&2
  echo "       aeolus-ask.sh replace <questionId> --title <title> ... (as ask)" >&2
  exit 2
}

# A JSON string's contents: aeolus_json_escape, and tabs and carriage returns too.
json() {
  aeolus_json_escape "$1" | sed -e "s/$(printf '\t')/\\\\t/g" -e "s/$(printf '\r')/\\\\r/g"
}

new_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    uuidgen
  fi | tr 'A-F' 'a-f'
}

is_uuid() {
  printf '%s' "$1" | grep -Eqx '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
}

model=""
title=""
context=""
options=()
pick=""
why=""

# Reads the question's flags and --model; sets question, as JSON, and id.
read_question() {
  local keys=0 label detail
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --title) [ "$#" -ge 2 ] || usage "--title takes the title"; title="$2"; shift 2 ;;
      --context) [ "$#" -ge 2 ] || usage "--context takes the context"; context="$2"; shift 2 ;;
      --option)
        [ "$#" -ge 3 ] || usage "--option takes a label and a detail"
        label="$2" detail="$3"
        [ -n "$label" ] || usage "every option has a label"
        keys=$((keys + 1))
        options+=("{\"key\":${keys},\"label\":\"$(json "$label")\",\"detail\":\"$(json "$detail")\"}")
        shift 3
        ;;
      --pick) [ "$#" -ge 3 ] || usage "--pick takes an option number and why"; pick="$2"; why="$3"; shift 3 ;;
      --model) [ "$#" -ge 2 ] || usage "--model takes the model"; model="$2"; shift 2 ;;
      *) usage "unknown argument: $1" ;;
    esac
  done
  [ -n "$title" ] || usage "a question has a title"
  [ "$keys" -gt 0 ] || usage "a question has at least one option"
  printf '%s' "$pick" | grep -Eqx '[1-9][0-9]*' && [ "$pick" -le "$keys" ] || usage "the pick names one of the options, by its number"
  [ -n "$why" ] || usage "the pick says why"
  id="$(new_uuid)"
  local joined
  joined="$(IFS=,; printf '%s' "${options[*]}")"
  question="{\"id\":\"${id}\",\"title\":\"$(json "$title")\",\"context\":\"$(json "$context")\",\"options\":[${joined}],\"pick\":{\"option\":${pick},\"why\":\"$(json "$why")\"}}"
}

read_model() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --model) [ "$#" -ge 2 ] || usage "--model takes the model"; model="$2"; shift 2 ;;
      *) usage "unknown argument: $1" ;;
    esac
  done
}

# Sets asked to the selector of the ship's owner, as whoami names it now;
# argo by name when the ship has none. Exits as aeolus-fleet.sh does when the
# fleet does not answer whoami, so nothing is sent to a guessed ship.
read_owner() {
  local output status ownerShipId
  output="$("$(dirname "$0")/aeolus-fleet.sh" whoami)"
  status=$?
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; exit "$status"; }
  ownerShipId="$(aeolus_json_string "$output" ownerShipId)"
  if [ -n "$ownerShipId" ]; then
    asked="{\"kind\":\"ship\",\"shipId\":\"$(json "$ownerShipId")\"}"
  else
    asked='{"kind":"ship","name":"argo"}'
  fi
}

# The file that keeps the selector of the ship a question asked. <questionId>
question_file() {
  local folder dir
  folder="$(aeolus_folder)" || exit 1
  dir="$(aeolus_ships_dir)" || exit 1
  printf '%s/%s.questions/%s' "$dir" "$(aeolus_key "$folder")" "$(printf '%s' "$1" | tr 'A-F' 'a-f')"
}

# Sets asked to the selector of the ship the question asked; refuses a
# question this folder did not ask, so nothing is sent to a guessed ship.
# <questionId>
read_asked() {
  local file
  file="$(question_file "$1")"
  [ -r "$file" ] || usage "this folder did not ask question $1, so the ship it asked is not known"
  asked="$(cat "$file")"
}

# Keeps the ship asked as the ship question <questionId> asked.
keep_asked() {
  local file
  file="$(question_file "$1")"
  (umask 077 && mkdir -p "$(dirname "$file")" && printf '%s' "$asked" >"$file") ||
    echo "aeolus: could not keep the ship question $1 asked; withdraw or replace it by hand" >&2
}

# Sends the ship asked <content type> <payload as JSON> <idempotency key>;
# prints what aeolus-fleet.sh prints, and sets sent to the message's id.
send_asked() {
  local input output status
  input="{\"selector\":${asked},\"contentType\":\"$1\",\"payload\":\"$(json "$2")\",\"idempotencyKey\":\"$3\"${model:+,\"model\":\"$(json "$model")\"}}"
  output="$(printf '%s' "$input" | "$(dirname "$0")/aeolus-fleet.sh" send -)"
  status=$?
  printf '%s\n' "$output"
  [ "$status" -eq 0 ] || exit "$status"
  sent="$(aeolus_json_string "$output" messageId)"
}

command="${1:-}"
[ "$#" -gt 0 ] && shift
case "$command" in
  ask)
    read_question "$@"
    read_owner
    send_asked "$QUESTION_CONTENT_TYPE" "$question" "question-${id}"
    keep_asked "$id"
    echo "aeolus: asked your ship's owner question ${id} (message ${sent}); its answer arrives as a reply to that message. Withdraw or replace the question by its uuid ${id}."
    ;;
  withdraw)
    questionId="${1:-}"
    is_uuid "$questionId" || usage "withdraw takes the question's uuid"
    shift
    read_model "$@"
    read_asked "$questionId"
    send_asked "$WITHDRAWAL_CONTENT_TYPE" "{\"questionId\":\"${questionId}\"}" "question-withdrawal-${questionId}"
    echo "aeolus: withdrew question ${questionId} (message ${sent})"
    ;;
  replace)
    questionId="${1:-}"
    is_uuid "$questionId" || usage "replace takes the question's uuid"
    shift
    read_question "$@"
    read_asked "$questionId"
    send_asked "$REPLACEMENT_CONTENT_TYPE" "{\"questionId\":\"${questionId}\",\"question\":${question}}" "question-replacement-${id}"
    keep_asked "$id"
    echo "aeolus: replaced question ${questionId} with question ${id} (message ${sent}); its answer arrives as a reply to that message. Withdraw or replace the question by its uuid ${id}."
    ;;
  *)
    usage
    ;;
esac
