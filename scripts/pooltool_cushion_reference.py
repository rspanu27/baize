"""Generate reference ball-cushion results from pooltool for comparison tests.

Offline script: it is not part of the build and nothing in the packages depends on it.

It calls two of pooltool's ball-cushion models on a grid of impacts and writes the inputs and
results to packages/physics/test/fixtures/pooltool-cushion.json:

  - han_2005:      pooltool's implementation of Han (2005), the closed-form impulse model that
                   Baize's cushion model is meant to agree with.
  - mathavan_2010: pooltool's implementation of Mathavan, Jackson & Parkin (2010), a more
                   detailed model that integrates the impact and includes the table's
                   friction. Used to show how far the simple model is from a better one.

pooltool is by Evan Kiefl and contributors, Apache-2.0: https://github.com/ekiefl/pooltool
Only numbers produced by running pooltool are stored; no pooltool code is copied into Baize.

Setup (any Python 3.10 to 3.13):
    python -m venv venv
    venv/Scripts/python -m pip install pooltool-billiards --extra-index-url https://archive.panda3d.org/simple/
    venv/Scripts/python scripts/pooltool_cushion_reference.py

Frame used in the file (Baize's): the cushion is the left-hand rail, its normal n = (1, 0)
points into the table, the ball arrives with v.x < 0, z is up, SI units.
"""

import json
import math
import pathlib

import numpy as np
import pooltool
from pooltool.physics.resolve.ball_cushion.han_2005.model import han2005
from pooltool.physics.resolve.ball_cushion.mathavan_2010.model import solve as mathavan_solve

OUT = pathlib.Path(__file__).resolve().parent.parent / "packages/physics/test/fixtures/pooltool-cushion.json"

BALLS = [
    {"name": "pool", "radiusM": 0.028575, "massKg": 0.163},
    {"name": "snooker", "radiusM": 0.02625, "massKg": 0.142},
]
# (nose height as a fraction of ball diameter, restitution, cushion friction)
CUSHIONS = [
    (0.635, 0.85, 0.2),
    (0.635, 0.98, 0.14),
    (0.70, 0.85, 0.2),
    (0.55, 0.7, 0.3),
    (0.635, 0.85, 0.05),
]
TABLE_SLIDING_FRICTION = 0.2  # ball-cloth sliding friction, used by the Mathavan model only
SPEEDS = [0.3, 1.0, 5.0]
ANGLES_DEG = [0, 30, 60, 75]  # from the cushion normal
# Spin about the horizontal axes, as a multiple of natural roll for the ball's velocity.
ROLL = [0.0, 1.0, -0.6]
# Side spin (about z) as a multiple of speed / radius.
SIDE = [0.0, 1.0, -2.5]


def han(v, w, R, m, h, e, f):
    rvw = np.array([[0.0, 0.0, R], [v[0], v[1], 0.0], [w[0], w[1], w[2]]])
    # pooltool wants the normal pointing the way the ball is travelling: out of the table.
    out = han2005(rvw, np.array([-1.0, 0.0, 0.0]), R, m, h, e, f)
    return [float(out[1, 0]), float(out[1, 1])], [float(out[2, 0]), float(out[2, 1]), float(out[2, 2])]


def mathavan(v, w, R, m, h, e, f):
    # pooltool's Mathavan frame: +y towards the cushion, +x along the rail, z up.
    # With the cushion normal n = (1, 0) into the table: y_m = -x, x_m = y.
    vx, vy, wx, wy, wz = mathavan_solve(
        m, R, h, e, TABLE_SLIDING_FRICTION, f, v[1], -v[0], w[1], -w[0], w[2]
    )
    return [float(-vy), float(vx)], [float(-wy), float(wx), float(wz)]


# One row per impact, to keep the file small:
# [ball index, cushion index, speed, angle (deg), roll, side,
#  v.x, v.y, w.x, w.y, w.z,                      (before)
#  han v.x, v.y, w.x, w.y, w.z,                  (after, han_2005)
#  mathavan v.x, v.y, w.x, w.y, w.z]             (after, mathavan_2010)
rows = []
for bi, ball in enumerate(BALLS):
    R = ball["radiusM"]
    m = ball["massKg"]
    for ci, (nose, e, f) in enumerate(CUSHIONS):
        h = nose * 2 * R
        for speed in SPEEDS:
            for deg in ANGLES_DEG:
                a = math.radians(deg)
                v = [-speed * math.cos(a), speed * math.sin(a)]
                for roll in ROLL:
                    for side in SIDE:
                        # Natural roll: w = (z x v) / R = (-v.y, v.x, 0) / R.
                        w = [-roll * v[1] / R, roll * v[0] / R, side * speed / R]
                        hv, hw = han(v, w, R, m, h, e, f)
                        mv, mw = mathavan(v, w, R, m, h, e, f)
                        rows.append([bi, ci, speed, deg, roll, side, *v, *w, *hv, *hw, *mv, *mw])

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(
    json.dumps(
        {
            "source": "pooltool " + pooltool.__version__ + " (Apache-2.0, https://github.com/ekiefl/pooltool)",
            "generatedBy": "scripts/pooltool_cushion_reference.py",
            "frame": "cushion normal n = (1, 0) into the table; ball arrives with velocity.x < 0; z up; SI units",
            "tableSlidingFriction": TABLE_SLIDING_FRICTION,
            "balls": BALLS,
            "cushions": [
                {"noseHeightPerDiameter": n, "restitution": e, "friction": f} for n, e, f in CUSHIONS
            ],
            "columns": "ball, cushion, speed, angleDeg, roll, side, vx, vy, wx, wy, wz, han vx vy wx wy wz, mathavan vx vy wx wy wz",
            "rows": rows,
        },
        separators=(",", ":"),
    )
    + chr(10)
)
print(len(rows), "impacts written to", OUT)
