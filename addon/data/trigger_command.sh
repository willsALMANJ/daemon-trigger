#!/usr/bin/env bash

# This source code is part of Daemon Trigger, a Firefox
# add-on that triggers commands when certain URL's are requested.
#    Copyright (C) 2015 Will Shanks
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software Foundation,
# Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA

cmd="$1"
timeout="$2"
match_str="$3"

# Expand out any variables in cmd, PATH
cmd="$(eval echo "$cmd")"
PATH="$(eval echo "$PATH")"

sanitize_cmd() {
	# Sanitize command string to make a recognizable temporary file name from
	# it
	cmd_str="$1"
	# Replace spaces
	cmd_str="${cmd_str// /_}"
	# Get command and sanitize
	cmd_str="$(basename "$cmd_str")"
	cmd_str="$(sed 's/[^A-Za-z0-9._]/_/g' <<< "$cmd_str")"
	cmd_str="$(sed 's/^_*//' <<< "$cmd_str")"
	cmd_str="$(sed 's/_*$//' <<< "$cmd_str")"
	cmd_str="$(sed -r 's/_+/_/g' <<< "$cmd_str")"
	echo "${cmd_str:0:20}"
}

tmpfile_template="$(basename -s .sh "$0")_$(sanitize_cmd "$1").XXXXXX"

cmd_already_running=false
cmd_pids=($(pgrep -f "$cmd"))
for cpid in "${cmd_pids[@]}"; do
	if [ "$cpid" != "$$" ]; then
		cpid_full_cmd="$(ps -q "$cpid" -o 'args=')"
		# Test that full cmd matches end of cmd in case the full execution of
		# cmd prepends extra content like "/usr/bin"
		if [[ "$cpid_full_cmd" =~ $cmd$ ]]; then
			cmd_already_running=true
			break
		fi
	fi
done

start_time=$(date +%s)
if [ "$cmd_already_running" = false ]; then
	# Execute cmd as background process with output redirected to temporary
	# tmpfile
	tmpfile="$(mktemp --tmpdir "${tmpfile_template}")"
	# Break up command and options for evaluation
	cmd_arr=($cmd)
	"${cmd_arr[@]}" &> "${tmpfile}" &
	cmd_pid="$!"
	cmd_ps_full="$(ps -q "$cmd_pid" -o 'args=')"
	# Loop until tmpfile contains match_str, or until
	# timeout is reached or cmd's process ends.
	while [ $(date +%s) -lt $(($start_time+$timeout)) ]; do
		if [[ "$(cat "${tmpfile}")" =~ "$match_str" ]]; then
			echo "CMD:""$cmd_ps_full"
			exit
        fi
		sleep 0.1

		# Test child process is still running
		found="false"
		# Search through current children of shell for cmd_pid
		children=($(pgrep -P "$$"))
		for child in "${children[@]}"; do
			if [ "$child" == "$cmd_pid" ]; then
				found="true"
			fi
		done
		if [ "$found" == "false" ]; then
			echo "Process failed"
			exit 1
		fi
	done;
	echo "Timeout"
	exit 1
fi
