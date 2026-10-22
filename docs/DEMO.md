# Flock — 3-minute demo script

**Setup before 22:20:** two phones signed in as different students, projector on `/dashboard`, Notion Safety HQ open in a tab, Discord session thread open, one blocked test account ready.

| Time | Beat | What's on screen | Criteria hit |
|---|---|---|---|
| 0:00–0:20 | **Community + problem.** "This is for London university students, starting with The Hack Collective. We study and build late, like tonight, then walk home alone. Today's answer is 'anyone going my way?' in a group chat." | Group chat screenshot with no reply | 3, 4 |
| 0:20–0:40 | **Verified spaces.** Sign in with a university email; a non-university email is rejected. Session imported from The Hack Collective's Luma calendar. | `/login`, `/sessions` | 3, 1 |
| 0:40–1:00 | **Grok Bot nudges.** Discord: "Heading out soon? Find someone going your way." | Discord thread | 2 |
| 1:00–1:45 | **Live match.** Phone A picks Hammersmith; Phone B picks Ravenscourt Park → match appears live on both, with trust reasons and the Cognee "why you can trust them". Show seconds-to-match. | Two phones on camera | 1, 4, 6 |
| 1:45–2:15 | **Safety.** Blocked account joins the same session → never matched. A missed check-in → Notion incident appears live, Grok Bot's recommendation attached. | Notion Safety HQ | 1, 3, 5 |
| 2:15–2:35 | **10x + growth.** Dashboard: average seconds to match vs ~10 min today; real matches from tonight's attendees. Zero pipeline of London student societies. | `/dashboard`, Zero | 4, 5 |
| 2:35–3:00 | **How it was built.** BUILD_LOG: what Grok Bot did, what Cursor did. "Any student society can switch this on next week." | `BUILD_LOG.md` | 2, 5 |

## Numbers to fill in before demo

- Real matches tonight: `__`
- Average seconds to match: `__`
- Grok Bot tasks logged: `__` · Cursor commits: `__`
- London Luma events ending after 21:00 this week: `__`

## Pre-flight checklist (21:15)

- [ ] Both demo accounts verified, trust reasons populated
- [ ] Blocked test account on blocklist
- [ ] Cognee service running (`:8001`); fallback label visible if not
- [ ] Discord bot online; session thread exists
- [ ] Notion Incidents database shared with the integration
- [ ] Zero webhook receiving
- [ ] Screenshots saved in case Wi-Fi fails
