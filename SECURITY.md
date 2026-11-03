# Security policy

## Supported versions

Ledge is in early preview. Security fixes go into the latest release only.

| Version | Supported |
|---|---|
| Latest 0.x release | Yes |
| Older releases | No |

## What is security-sensitive in Ledge

- **Touchpad access.** `packaging/70-ledge-touchpad.rules` gives the logged-in
  user read access to touchpad devices. A rule that matches more than
  touchpads, especially keyboards, would let any process in the session read
  input. That is a vulnerability.
- **The helper.** `ledge-touchd` runs as your user and parses raw kernel input
  events. It must never grab or write to the device.
- **The session bus.** The helper publishes gestures on the session bus.
  Development hooks (`io.github.gabrielgirardi.Ledge.Dev1`) can capture
  screenshots, so they must only load when `LEDGE_DEV` is set. If they load in
  a normal session, that is a vulnerability.
- **Network.** Only the weather widget makes requests, and only to Open-Meteo
  over HTTPS.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting: go
to the **Security** tab of the repository and choose **Report a
vulnerability**.

Include the affected version, the steps to reproduce, and the impact you
expect. You can expect a first response within 7 days. A fix or mitigation
plan should follow within 30 days. Reporters are credited in the release
notes unless they ask not to be.
