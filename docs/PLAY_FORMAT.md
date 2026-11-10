# Play file format (`format: 1`)

Each play is `plays/<id>.json`. The `id` must match the file name and is what share links use (`?play=<id>`),
so it stays the same when a play is renamed.

```json
{
  "format": 1,
  "id": "switch-3-and-4-attack-by-3",
  "name": "Switch 3 and 4 attack by 3",
  "serving": "A",
  "intro": "",
  "updated": "2026-11-10T03:00:00Z",
  "start": {
    "pos": { "A1": [-36, 222], "A2": [216, 222], "…": "…", "B6": [464, 173] },
    "ball": { "holder": "A1" }
  },
  "steps": [
    {
      "cap": "Serve to Red 1",
      "dur": 1769,
      "arc": 75,
      "moves": { "B3": [345, 230], "B4": [354, 172] },
      "ball": { "holder": "B1" }
    }
  ]
}
```

## Fields

| Field | Meaning |
|---|---|
| `id` | File name without `.json`. Lowercase letters, digits and hyphens. |
| `name` | Shown in the play list. |
| `serving` | `"A"` (Blue, left side) or `"B"` (Red, right side). Only used for the “serving / receiving” labels. |
| `intro` | Optional caption shown before step 1. |
| `updated` | ISO timestamp of the last save. |
| `start.pos` | Position of all 12 players at the start. Keys `A1`–`A6` (Blue) and `B1`–`B6` (Red); the number is the player's starting zone. |
| `start.ball` | Who has the ball at the start: `{ "holder": "A1" }`. |
| `steps[]` | What happens, in order. |

### A step

| Field | Meaning |
|---|---|
| `cap` | Caption shown during the step (may be empty). |
| `moves` | Players who run in this step and where they end up. Players not listed stay where they were. |
| `ball` | Where the ball goes: `{ "holder": "B3" }` (thrown or passed to a player), `{ "point": [x, y] }` (lands on the floor), or `null` (stays where it is, moving with its holder). |
| `dur` | Duration in milliseconds at 1× speed. |
| `arc` | How high the ball flies (drawing units). 0 when the ball doesn't move. |

## Coordinates

1 metre = 30 units. The court runs from `x = 0` (Blue's end line) to `x = 540` (Red's end line) and from `y = 0`
to `y = 270` across. The net is at `x = 270`, the attack lines at `x = 180` and `x = 360`.
Positions slightly outside the court are allowed (for example the server behind the end line, `x = -36`).

From Blue's point of view (facing the net, to the right), `y = 0` is on their left. For Red it is on their right.

## plays/index.json

```json
{
  "folders": ["Serve receive", "Serve receive/Rotation 1", "Switches"],
  "plays": [
    { "id": "switch-3-and-4-attack-by-3", "name": "Switch 3 and 4 attack by 3", "folder": "Switches",
      "file": "switch-3-and-4-attack-by-3.json", "updated": "2026-11-10T03:00:00Z" }
  ]
}
```

- `folders` lists every folder, including empty ones. `/` separates subfolders.
- Each play entry's `folder` is where it shows in the tree (`""` = top level). The play file itself doesn't store its folder,
  so reorganizing never rewrites play files.
- Within a folder, plays appear in the order they are listed here.
