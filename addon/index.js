/*
This source code is part of Daemon Trigger, a Firefox
add-on that triggers commands when certain URL's are requested.
   Copyright (C) 2015 Will Shanks

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software Foundation,
Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301  USA
 */

/* global console, require */
'use strict'

var self = require('sdk/self')
var notifications = require('sdk/notifications')
var child_process = require("sdk/system/child_process");
var { env } = require('sdk/system/environment');
var events = require("sdk/system/events");
var simple_prefs = require('sdk/simple-prefs')
var { setTimeout } = require('sdk/timers')

// Look up the path to the bash script included with the addon.
const {Cc, Cu, Ci} = require("chrome");
/* global Services */
Cu.import("resource://gre/modules/Services.jsm");
const ResProtocolHandler = Services.io.getProtocolHandler("resource").
                           QueryInterface(Ci.nsIResProtocolHandler);
const ChromeRegistry = Cc["@mozilla.org/chrome/chrome-registry;1"].
                       getService(Ci.nsIChromeRegistry);
function resolveToFile(uri) {
  switch (uri.scheme) {
    case "chrome":
      return resolveToFile(ChromeRegistry.convertChromeURL(uri));
    case "resource":
      return resolveToFile(
		  Services.io.newURI(
			  ResProtocolHandler.resolveURI(uri), null, null));
    case "file":
      return uri.QueryInterface(Ci.nsIFileURL).file;
    default:
      throw new Error("Cannot resolve");
  }
}
var script_path = resolveToFile(
	Services.io.newURI(
		self.data.url('trigger_command.sh'), null, null)).path

// Process the triggers stored in preferences
// url_regex_arr: array of url regular expressions to match to
var url_regex_arr = []
// all_url_regex: all of the url regular expressions combined into one big
// regular expression
var all_url_regex = ''
var triggers
function update_url_regex() {
	triggers = JSON.parse(simple_prefs.prefs.triggers)
	triggers = triggers.array
	url_regex_arr = []
	for (let trigger of triggers) {
		url_regex_arr.push(new RegExp(trigger.url_regex))
	}
	all_url_regex = new RegExp(url_regex_arr.
		map(function(val) {return '(' + val.source + ')'}).
		join('|'))
}
update_url_regex()
simple_prefs.on("triggers", update_url_regex)

// URL matching helper function
function url_match_index(url) {
	let match_idx
	for (let idx=0; idx<url_regex_arr.length; idx++) {
		if (url_regex_arr[idx].test(url)) {
			match_idx = idx
			break
		}
	}
	return match_idx
}

function create_environment(trigger) {
	// Environment variable precedence: trigger environment pref, global
	// environment pref, default vars
	let default_vars = ['HOME', 'PATH', 'USER']
	let new_env = {}
	for (let varName of default_vars) {
		new_env[varName] = env[varName]
	}
	
	function merge_env(src, dest) {
		for (let varName in src) {
			if ((varName in dest) && (varName == 'PATH')) {
				dest.PATH = src.PATH + ':' + dest.PATH
			} else {
				dest[varName] = src[varName]
			}
		}
	}

	merge_env(JSON.parse(simple_prefs.prefs.environment), new_env)
	if ('environment' in trigger) {
		merge_env(trigger.environment, new_env)
	}

	return new_env
}

// Set up the URL command triggers
function listener(event) {
	var channel = event.subject.QueryInterface(Ci.nsIHttpChannel)
	let url = channel.URI.spec
	
	// Test against all_url_regex first because it is faster for non-matches
	if (all_url_regex.test(url)) {
		let match_idx = url_match_index(url)
		let trigger = triggers[match_idx]
		let args = [script_path,
					trigger.cmd,
					(trigger.timeout || simple_prefs.prefs.timeout).toString(),
					trigger.success_regex]
		let options = {'env': create_environment(trigger)}
		let result = child_process.spawn(simple_prefs.prefs.bashPath, args,
										 options)
		// The following block of code blocks execution of this function until
		// child_process is closed. We don't want to return before that because
		// we don't know that the process serving the target url is ready until
		// child_process exits. The odd thread manager code is one of the few
		// ways to block a process in Javascript without spinning up the CPU or
		// freezing the whole browser.
		let delayed = true
		result.on('close', function() {delayed = false})
		var thread = Cc["@mozilla.org/thread-manager;1"].
			getService(Ci.nsIThreadManager).currentThread;
		while (delayed) {
			thread.processNextEvent(true)
		}
	}
}
events.on("http-on-modify-request", listener);
