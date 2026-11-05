"""UI regression tests. Run with tests/ui/run.sh (needs GNOME Shell 46).

Each test that guards a past bug names it, so a failure says what came back.
"""

import unittest

from harness import ESCAPE, Shell

shell = None


def setUpModule():
    global shell
    shell = Shell()


def tearDownModule():
    shell.stop()


class PanelTest(unittest.TestCase):
    def setUp(self):
        shell.close_panel()
        shell.warp(800, 500)  # monitor 0

    def test_escape_closes(self):
        shell.open_panel()
        shell.key(ESCAPE)
        shell.wait_for(lambda: shell.state()["state"] == "CLOSED", "closed after Esc")
        self.assertFalse(shell.state()["grab"], "input grab must be released")

    def test_click_outside_closes(self):
        # 0.2.0: the listener sat on the stage, which sees nothing during the grab.
        shell.open_panel()
        shell.click(300, 500)
        shell.wait_for(lambda: shell.state()["state"] == "CLOSED", "closed after outside click")

    def test_click_inside_keeps_open(self):
        x, y, _w, _h = shell.open_panel()["targets"]["date"]
        shell.click(x, y)
        self.assertEqual(shell.state()["state"], "OPEN")

    def test_settings_button_accepts_clicks_across_its_width(self):
        # 0.3.0: the right ~38 px of the panel ignored clicks while still painting.
        x, y, w, _h = shell.open_panel()["targets"]["gear"]
        for dx in (-w // 2 + 3, 0, w // 2 - 3):
            self.assertTrue(shell.pick(x + dx, y).startswith("ledge:gear"),
                            f"gear not hit at x{dx:+d}: {shell.pick(x + dx, y)}")
        shell.click(x, y)
        shell.wait_for(lambda: shell.state()["state"] == "CLOSED", "closed after the gear")

    def test_opens_on_the_monitor_under_the_pointer(self):
        shell.warp(2200, 400)  # monitor 1
        self.assertEqual(shell.open_panel()["monitor"], 1)
        shell.close_panel()
        shell.warp(800, 500)
        self.assertEqual(shell.open_panel()["monitor"], 0)


class TodoTest(unittest.TestCase):
    def setUp(self):
        shell.close_panel()
        shell.warp(800, 500)
        shell.open_panel()
        for _ in shell.todos():
            shell.click_target("todo-trash:0")
        shell.wait_for(lambda: shell.todos() == [], "empty list")
        shell.click_target("todo-entry")
        shell.type("Alpha\nBravo\nCharlie\n")
        shell.wait_for(lambda: len(shell.todos()) == 3, "three tasks")

    def done(self):
        return [(t["text"], t["done"]) for t in shell.todos()]

    def test_check_twice_toggles_the_same_task(self):
        # 0.3.0: a checked task jumped to the end, so the next click hit another one.
        shell.click_target("todo-check:0")
        shell.wait_for(lambda: shell.todos()[0]["done"], "Alpha done")
        shell.click_target("todo-check:0")
        shell.wait_for(lambda: not shell.todos()[0]["done"], "Alpha not done")
        self.assertEqual(self.done(), [("Alpha", False), ("Bravo", False), ("Charlie", False)])

    def test_rows_keep_their_order(self):
        shell.click_target("todo-check:0")
        shell.click_target("todo-check:1")
        shell.wait_for(lambda: sum(t["done"] for t in shell.todos()) == 2, "two done")
        self.assertEqual(self.done(), [("Alpha", True), ("Bravo", True), ("Charlie", False)])

    def test_trash_and_clear_completed(self):
        shell.click_target("todo-trash:1")
        shell.wait_for(lambda: len(shell.todos()) == 2, "Bravo deleted")
        shell.click_target("todo-check:0")
        shell.wait_for(lambda: shell.todos()[0]["done"], "Alpha done")
        shell.click_target("todo-clear")
        shell.wait_for(lambda: [t["text"] for t in shell.todos()] == ["Charlie"], "only Charlie left")


if __name__ == "__main__":
    unittest.main()
