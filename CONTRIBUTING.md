# Contributing to Ledge

Thanks for helping. This guide covers how to set up a development
environment, what a good change looks like, and how changes get released.
Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** Use the *Bug report* issue form. It asks for your GNOME
  version, session type, and logs. Without these, most bugs cannot be
  reproduced.
- **Suggest a feature.** Use the *Feature request* form. Describe the
  problem you want solved, not only the solution.
- **Translate.** See [Translations](#translations).
- **Write code.** For anything bigger than a small fix, open an issue first and
  agree on the approach. This keeps your pull request from being turned down
  late.

Issues labeled `good first issue` are a good place to start.

## Development setup

You need GNOME Shell 46, Node.js (only to run syntax checks), Python 3 with
PyGObject, and the `gettext`, `glib-compile-schemas`, and `zip` tools.

```sh
git clone https://github.com/GabrielGirardi/ledge.git
cd ledge
./scripts/install-udev-rule.sh   # once: lets your user read the touchpad
./scripts/nested.sh              # opens a nested GNOME Shell with Ledge loaded
```

`nested.sh` starts a GNOME Shell in a window, on its own session bus, with
the touchpad helper attached. Use it for almost all work: on Wayland, the
GNOME Shell you are logged into cannot reload extension code without a log
out. To try a change, close the nested window and run `nested.sh` again.

The nested shell has a separate session bus, so it does not see your music
players or other session services. Test the Now Playing widget either in your
real session or with a player started on the nested bus.

### Headless shell and development hooks

`scripts/headless.sh` starts GNOME Shell without a window. It runs Ledge from
your checkout with development hooks on, and returns once the extension is
`ACTIVE`. In the nested window, the pointer belongs to your real session, so a
scripted click lands wherever your mouse left the window. In the headless
shell, the pointer is fully controllable. Use it to reproduce input bugs and
to check behavior from a script:

```sh
./scripts/headless.sh                         # prints READY and the log path
LEDGE_MONITORS="1600x1000 1280x800" ./scripts/headless.sh   # two monitors
./scripts/dev-signal.sh Toggle                # open the panel
./scripts/dev-signal.sh Click 300 500         # click outside it
./scripts/dev-signal.sh State                 # log state, grab, and key focus
grep ledge-state "$XDG_RUNTIME_DIR/ledge-nested/shell.log"
./scripts/headless.sh --stop
```

| Hook | Effect |
|---|---|
| `Toggle` | Same as the keyboard shortcut |
| `Show P` | Pins the panel at a position from 0 (closed) to 1 (open) |
| `Click X Y`, `Scroll X Y STEPS` | Real pointer events, through the same path as a mouse |
| `Warp X Y` | Moves the pointer, which decides the active monitor |
| `Push DX STEPS` | Relative pointer motion, for the hot edge |
| `Drag X Y DY STEPS` | Press, move, release, for edit mode |
| `Pick X Y` | Logs the actor under a point and its parents. Use it when a click does not land where you expect. |
| `Key KEYVAL`, `Type TEXT` | Real key events. `65307` is Escape; `\n` in the text presses Return. |
| `Shot PATH` | Saves a PNG of the whole stage |
| `State`, `Dump` | Log the panel state, or the allocation of every layer |

`nested.sh` also sets `LEDGE_DEV=1`, so the same hooks work there. The hooks
never load in a normal session.

Both shells use a private data folder (`$XDG_RUNTIME_DIR/ledge-nested/data`).
An installed copy of Ledge stays untouched, and the to-do list and screen
time you see in them are separate from your real ones.

### UI tests

`tests/ui/` drives a headless GNOME Shell through the development hooks and
checks the result. It covers opening and closing, picking (whether clicks land
on what is drawn), multi-monitor placement, and the to-do list. CI runs it on
every push and pull request.

```sh
./tests/ui/run.sh                                     # everything, about a minute
./tests/ui/run.sh test_panel.TodoTest                 # one class
```

Tests click actors by name, not by pixel. Give anything a test needs to reach
a name that starts with `ledge:` (for example `name: 'ledge:gear'`). In
development mode, the extension's `DevQuery1.GetState()` reports where every
such actor is, together with the panel state.

When you fix a bug that users can see, add a test that fails without the fix,
and say in its comment which version had the bug. Before you push, check that
the test does fail: put the bug back and run it.

### Gesture helper

To see what the helper detects, run it in the foreground:

```sh
python3 touchd/ledge-touchd.py -v        # one line per detected swipe
python3 touchd/ledge-touchd.py --trace   # every raw touchpad frame
```

Attach a `--trace` capture to gesture bug reports. It shows exactly what the
touchpad reported.

### README images

`docs/images/` is generated. Do not edit the images by hand. To refresh them
after a visual change, run:

```sh
./tools/screenshots/run.sh
```

The script opens a nested GNOME Shell for about a minute, with an isolated
profile: a generated wallpaper and album art, a local calendar of fictional
events, and a demo music player. Your own accounts, calendars, and extensions
never appear in the images. Batteries and weather are live.

## Making a change

1. Fork the repository and create a branch from `main`:
   `feat/hot-corner`, `fix/agenda-all-day`, `docs/readme-install`.
2. Keep each pull request to one logical change. A refactor and a feature go in
   separate pull requests.
3. Run `./scripts/check.sh` and make sure it passes. CI runs the same script.
4. Test the change in the nested shell. For anything visual, attach a
   screenshot or a short recording to the pull request.
5. Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md),
   unless the change is invisible to users (CI, refactors, internal docs).
6. Open the pull request and fill in the template.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <summary in the imperative, lower case, no period>
```

| Type | Use for |
|---|---|
| `feat` | A user-visible feature |
| `fix` | A user-visible bug fix |
| `perf` | A performance improvement |
| `refactor` | A code change that adds no feature and fixes no bug |
| `docs` | Documentation only |
| `i18n` | Translations |
| `test`, `ci`, `build`, `chore` | Tooling and maintenance |

Examples: `feat(widgets): add phone battery from GSConnect`,
`fix(gesture): ignore swipes that start with three fingers`.

Mark a breaking change with `!` after the type (`feat!: ...`), and explain it
in the commit body. In Ledge, "breaking" means removing or renaming a setting,
changing the D-Bus protocol between helper and extension, or dropping a GNOME
version.

### Code style

**JavaScript (extension)**

- Follow the GNOME Shell style: ES modules, 4-space indentation, single
  quotes, `const` by default, and private members prefixed with `_`.
- Never block the compositor. Use the async variant of every D-Bus, file, and
  network call. A synchronous call freezes the whole desktop.
- Clean up everything in `destroy()`: signal connections, D-Bus subscriptions,
  timeouts, and actors. `disable()` must leave the shell exactly as it found
  it. extensions.gnome.org reviewers reject extensions that leak.
- Wrap every user-visible string in `_()`. Do not translate log messages.
- Dates and times go through `locale.js`. Dates follow the user's `LC_TIME`,
  which can differ from their UI language.
- Add a widget as its own module in `widgets/`. It exposes `actor`, an
  optional `refresh()` that runs when the panel opens, and `destroy()`.
- Persist widget data with `JsonStore` (`store.js`). It writes asynchronously
  to `~/.local/share/ledge/`, one write at a time. Never read or write files
  synchronously.

**Python (helper)**

- Use only the standard library and PyGObject. The helper must run on a stock
  GNOME system without `pip`.
- Keep it read-only. It must never grab the device or write to it.

**Comments** explain *why*, not *what*. Leave out comments that repeat the code.

### Pull request review

- The maintainer aims to give a first response within a week.
- A pull request needs one approving review and a green CI before it merges.
- Pull requests are squash-merged. The pull request title becomes the commit
  message, so it must follow the commit format above.
- A pull request with no reply to review comments for 30 days may be closed.
  You can reopen it at any time.

## Translations

Translations live in `po/` as gettext `.po` files.

- **Add a language:** run `msginit -l <lang> -i po/ledge.pot -o po/<lang>.po`,
  translate the strings, and open a pull request with the title
  `i18n: add <language>`.
- **Update a language:** run `./scripts/update-po.sh` to merge new strings, then
  translate the empty `msgstr` entries.
- **Test a translation:** run `LANGUAGE=<lang> ./scripts/nested.sh`.

Developers who add or change user-visible strings must run
`./scripts/update-po.sh` in the same pull request. `check.sh` fails when
`po/ledge.pot` is out of date.

## Versioning and releases

Ledge follows [Semantic Versioning](https://semver.org). The version lives in
`version-name` in `metadata.json`.

| Bump | When |
|---|---|
| Patch, `0.1.0` to `0.1.1` | Bug fixes only |
| Minor, `0.1.0` to `0.2.0` | New features or new GNOME versions, backward compatible |
| Major, `0.x` to `1.0.0` | Breaking changes. While in `0.x`, breaking changes bump the minor version instead. |

The maintainer cuts releases. [docs/RELEASING.md](docs/RELEASING.md) has the
full procedure. Contributors only need to keep `CHANGELOG.md` up to date.

## Licensing of contributions

Ledge is licensed under GPL-3.0-or-later. When you open a pull request, you
agree that your contribution is licensed the same way, and that you have the
right to submit it. Do not copy code from projects with incompatible licenses.
