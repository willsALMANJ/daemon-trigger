# Daemon Trigger
Trigger a shell command when a specific URL is visited

## Example use cases
* Access a website hosted on a server only accessible via an ssh tunnel without
  having to reopen the tunnel manually when it disconnects.

* Use a local web application (like an IPython notebook) without having to
  start the application manually before visiting it. 

## Summary of how it works
The user supplies a series of triggers in the add-on's preferences which are
used by the add-on to launch commands when certain URL's are visited. When the
browser requests a URL that matches one of the add-on's triggers, the add-on
pauses the loading of the page, executes the command that is associated with
that URL, waits until that command outputs a line matching a supplied regular
expression, and then allows the page to load.

## Basic usage
To use this add-on, you must set up one or more triggers in the add-on's
"Trigger properties" (`triggers`) preference (accessible via the add-on's entry
in the browser's Add-ons page). The `triggers` preference requires a JSON string
with a property called `array`. The `array` property should be an array of
objects with the fields `cmd`, `url_regex`, `success-regex`, and, optionally,
`environment`, `timeout` and `pause_after_startup`. These properties work as
follows:

* *url_regex*: A regular expression that will be checked against every URL that
  is requested. When a match is found, the command defined in `cmd` is executed.

* *cmd*: A command that will be executed when a requested URL matches
  `url_regex`. When the command is called, a check is first made to see if the
command is already running running and in that case it is not called a second
time.
* *success_regex*: A regular expression that is checked against the output of
  the executed command. When a match occurs, the add-on allows the original page
request to complete. This regex should check for output from the command that
indicates that it has finished its start up process and is ready to serve the
original request.

* *environment*: (_optional_) A JSON object whose properties will be set as
  environment variables in the context of the script that calls `cmd`.
  + `HOME`, `PATH`, and `USER` will be set to the values that are known to the
    browser if they are not set in `environment`.

  + The `PATH` known to the browser is typically the sytem path and does not
	include changes made by a user configuration file like `.bashrc`. 

  + There is also a global `environment` preference that sets variables for all
    triggers. Any variables set in a trigger's `environment` property overwrite
the global values.

  + `PATH` is handled slightly differently from other variables. Any values set
	in `environment` or in the `environment` of a trigger are preprended to
`PATH` known to the browser (with the trigger's `PATH` being pre-pended in
front of the global add-on `PATH`).

* *timeout*: (_optional_) A time in seconds after which the add-on will stop
  waiting for the executed `cmd` to output `success_regex` and try to load the
page request any way.

## More notes on functionality

### Triggers

* Here is an example entry for the `triggers` preferences:

    "{"array": [{"cmd": "python3 -u -m http.server", "url_regex": "^https?://localhost:8000", "success_regex": "Serving HTTP"}]}"

This example uses the `http.server` module of Python 3 to serve files from the
add-on's directory (the working directory when `cmd` is executed). It is
launched when port 8000 of `localhost` is visited (the default port used by
`http.server`). To try this example with Python 2, replace `python3` with
`python2` and `http.server` with `SimpleHTTPServer`. Note that the `-u` option
is needed because Python otherwise buffers its output and so the `success_regex`
is not output.

* It is recommended that the `triggers` property be run through a JSON lint
  program to verify that the `triggers` preference is properly formatted before
entering it into the add-on preferences. You might also want to keep a copy of
the property in a text file with multiline formatting for readability and put
its contents into a minifier to convert it into a single-line of text that can
be entered into the add-on's `triggers` preference's textbox.

### Preferences

* The "Path to bash" (`bashPath`) preference specifies the path to the version
  of `bash` to be used by the add-on (a bash script included with the add-on is used to call the `cmd` associated with a trigger). The default value is `/usr/bin/bash`.

* The "Timeout" preference sets the default time the add-on waits for all
  commands before giving up and trying to load the page. It can be overridden
for a specific trigger using the `timeout` property of the trigger.

* The "Environment" preference functions the same as the `environment` property
  of a trigger described in the triggers section.

### Command formatting and execution

* `cmd` is not executed directly by the browser. Instead it is executed as a
  background process by a bash script included with the add-on.

* `stdout` and `stderr` of `cmd` are redirected to a temporary file created by
  `mktemp --tmpdir`. The temporary file name is generated from the name of the
bash script included with the add-on ("trigger_command") and a sanitized version
of `cmd`. As noted in the Python example, care must be taken to ensure that the
output of `cmd` is not buffered when redirected to a file.

* The process launched by `cmd` will continue to write to a temporary file for
  its duration, so make sure it is not outputting enormous amounts of data over
its lifetime. There is no simple, secure way to redirect the output of a running
process to `/dev/null` after it has started.

* Because of the way `cmd` is executed, compound commands (and likely
  complicated single commands) are not supported (e.g. commands combined with
`;`, `|`, `&&` and `||`). Command line options for a single command are
supported. To launch a more complicated command, put it in a wrapper script.

* Before `cmd` is executed, a `ps` call is made to look for commands ending in
  `cmd`. If a match is found, the command is not executed again. This check is
done to prevent spawning new processes for every page visit. It is not foolproof
though, so if you have other processes containing this command in their
invocation they will prevent the add-on from starting a new process (for
example, if `cmd` is a script you wrote and you have it open in `vim` such that
it shows up as `vim cmd` in ps, the script will see this and think that the
command is running).

* `eval` is used to expand environment variables in `cmd` and in `PATH` before
  `cmd` is executed.

### Using a wrapper script

* A wrapper script can be used to start a more complicated process or to get a
  process to fit into the mold that the add-on expects. Simply write a script
that starts the process that you want to start (and does whatever else you need
done) and set your script as the `cmd` in the trigger preference.  The only
requirement on the script is that it prints out a message when the process has
started so that the add-on can allow the page to load.

* If the process you want to start does not print out any message when it is
  ready, you can start it in a bash wrapper script with `&` at the end of the
command to put it into the background. Then `echo "started"` to let the add-on
know that the process has started. If the process takes some time to start up,
you could add a `sleep` statement to pause before the `echo` or use a more
sophisticated method to test that the process is ready. Alternatively, you just
set the trigger's timeout to a short value (just long enough for the command to
finish its startup process) rather than using a wrapper script.

* If you start the long-running process you care about as a background process
  in a wrapper script, end the wrapper script with a `wait` statement so that
it does not exit until the background process does. The add-on checks to see if
the command `cmd` is still running and tries to run it again if it is not, so
the wrapper script needs to stay running as long as the background process is.

* If the process prints out a large amount of output that you don't want written
  to a temporary log file, you could use the wrapper script to filter out the
unwanted parts of its output.

* Keep in mind that when bash is run non-interactively, a limited amount of
  environment variables are defined, so you likely need to specify the full path
to the wrapper script rather than just giving its name and putting it in a
directory on the `PATH` as set in `.bashrc`.

### Miscellaneous

* Care was taken to use portable versions of command calls so that the bash
  script runs properly on Linux, BSD, and OS X (and possibly other platforms,
but so far it has only been tested on Linux with the GNU tools). It is perhaps
possible to get it to work with Windows using Cygwin, but someone familiar with
Cygwin would likely need to make at least a few modifications to the add-on to
enable this.

## Development

The addon uses the Firefox Add-on SDK. The XPI file can be built using `jpm`.

## TODO

* It would be nice to kill the daemon automatically when it is no longer
  needed. How to implement this is not yet decided.

  + When the trigger tab closes?
  + When Firefox closes?
  + When a matching URL closes and there are no remaining matching URL's open
    in other tabs?
