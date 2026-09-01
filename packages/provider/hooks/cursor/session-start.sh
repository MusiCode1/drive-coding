#!/usr/bin/env bash
# Back-compat wrapper → inject-prompt.sh (sessionStart / additional_context).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/inject-prompt.sh" sessionStart
