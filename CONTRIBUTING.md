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

### Development hooks

`nested.sh` sets `LEDGE_DEV=1`. In that mode, the extension listens for
signals on `io.github.gabrielgirardi.Ledge.Dev1`. With them you can drive the
panel and capture screenshots without touching the touchpad:

| Signal | Effect |
|---|---|
| `Show(d progress)` | Pins the panel at a position from 0 (closed) to 1 (open). |
| `Toggle()` | Same as the keyboard shortcut. |
| `Shot(s path)` | Saves a PNG of the whole stage. |
| `Dump()` | Logs the allocation of every panel layer. |

```sh
export DBUS_SESSION_BUS_ADDRESS=...   # the nested shell's bus, from /proc/<pid>/environ
gdbus emit --session --object-path /io/github/gabrielgirardi/Ledge/Touchpad \
  --signal io.github.gabrielgirardi.Ledge.Dev1.Show 1.0
```

The hooks never load in a normal session.

### Gesture helper

To see what the helper detects, run it in the foreground:

```sh
python3 touchd/ledge-touchd.py -v        # one line per detected swipe
python3 touchd/ledge-touchd.py --trace   # every raw touchpad frame
```

Attach a `--trace` capture to gesture bug reports. It shows exactly what the
touchpad reported.

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
