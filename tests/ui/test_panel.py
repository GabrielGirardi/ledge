"""UI regression tests. Run with tests/ui/run.sh (needs GNOME Shell 46).

Each test that guards a past bug names it, so a failure says what came back.
"""

import unittest

from harness import ESCAPE, Shell

DOWN = 65364
DEFAULT_WIDGETS = "['weather', 'batteries', 'calendar', 'todo', 'screen-time', 'media']"

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


class HotEdgeTest(unittest.TestCase):
    """Two monitors side by side: 0 is x 0-1600, 1 is x 1600-2880."""

    def setUp(self):
        shell.close_panel()
        shell.set_setting("hot-edge", "true")

    def tearDown(self):
        shell.set_setting("hot-edge", "true")

    def test_pushing_the_screen_edge_opens_the_panel(self):
        shell.warp(2700, 400)
        shell.push(30, 30)
        st = shell.wait_for(lambda: (s := shell.state())["state"] == "OPEN" and s, "open via hot edge")
        self.assertEqual(st["monitor"], 1)

    def test_shared_edge_between_monitors_is_free(self):
        self.assertEqual(shell.state()["hotEdges"], 1, "only the outer right edge gets a barrier")
        shell.warp(1500, 500)
        shell.push(30, 12)
        self.assertEqual(shell.state()["state"], "CLOSED")

    def test_can_be_turned_off(self):
        shell.set_setting("hot-edge", "false")
        self.assertEqual(shell.state()["hotEdges"], 0)
        shell.warp(2700, 400)
        shell.push(30, 30)
        self.assertEqual(shell.state()["state"], "CLOSED")


class WidgetsTest(unittest.TestCase):
    def setUp(self):
        shell.close_panel()
        shell.set_setting("widgets", DEFAULT_WIDGETS)
        shell.warp(800, 500)

    def tearDown(self):
        shell.close_panel()
        shell.set_setting("widgets", DEFAULT_WIDGETS)

    def edit(self):
        shell.open_panel()
        shell.click_target("edit")
        shell.wait_for(lambda: shell.state()["editing"], "edit mode")

    def test_setting_chooses_and_orders_widgets(self):
        shell.set_setting("widgets", "['todo', 'weather']")
        st = shell.open_panel()
        self.assertEqual(st["widgets"], ["todo", "weather"])
        self.assertNotIn("card:batteries", st["targets"], "a hidden widget must not exist")

    def test_edit_hide_and_add_back(self):
        self.edit()
        shell.click_target("hide:weather")
        shell.wait_for(lambda: "weather" not in shell.state()["widgets"], "weather hidden")
        shell.click_target("add:weather")
        shell.wait_for(lambda: shell.state()["widgets"][-1] == "weather", "weather added at the end")

    def test_edit_drag_reorders(self):
        self.edit()
        t = shell.state()["targets"]
        x, y, _w, _h = t["card:screen-time"]
        top = t["card:weather"][1] - t["card:weather"][3] // 2
        shell.drag(x, y, top + 10 - y)
        shell.wait_for(lambda: shell.state()["widgets"][0] == "screen-time", "screen-time first")

    def test_edit_fast_drag_crosses_several_cards(self):
        # 0.4 dev: one motion event moved a card one slot at most, so a quick
        # drag (or a slow machine) left the card short of the pointer.
        self.edit()
        t = shell.state()["targets"]
        x, y, _w, _h = t["card:screen-time"]
        top = t["card:weather"][1] - t["card:weather"][3] // 2
        shell.drag(x, y, top + 10 - y, steps=2)
        shell.wait_for(lambda: shell.state()["widgets"][0] == "screen-time", "screen-time first in two moves")

    def test_edit_keyboard_moves_the_focused_card(self):
        self.edit()
        shell.click_target("card:weather")  # a press without moving focuses the card
        shell.key(DOWN)
        shell.wait_for(lambda: shell.state()["widgets"][:2] == ["batteries", "weather"], "weather moved down")

    def test_cards_are_inert_while_editing(self):
        self.edit()
        shell.click_target("todo-entry")
        self.assertNotEqual(shell.state()["focus"], "Clutter_Text", "the task field must not take focus")

    def test_escape_leaves_edit_mode_before_closing(self):
        self.edit()
        shell.key(ESCAPE)
        st = shell.wait_for(lambda: (s := shell.state())["editing"] is False and s, "edit mode left")
        self.assertEqual(st["state"], "OPEN")
        shell.key(ESCAPE)
        shell.wait_for(lambda: shell.state()["state"] == "CLOSED", "closed")


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

    def test_list_is_not_squeezed_on_a_short_screen(self):
        # 0.3.1: on a screen shorter than the panel, the list shrank to a row or two.
        shell.close_panel()
        shell.warp(2200, 400)  # monitor 1 is 800 px tall
        t = shell.open_panel()["targets"]
        rows = t["todo-check:2"][1] - t["todo-check:0"][1] + t["todo-check:0"][3]
        self.assertGreaterEqual(t["todo-scroll"][3], rows)

    def test_trash_and_clear_completed(self):
        shell.click_target("todo-trash:1")
        shell.wait_for(lambda: len(shell.todos()) == 2, "Bravo deleted")
        shell.click_target("todo-check:0")
        shell.wait_for(lambda: shell.todos()[0]["done"], "Alpha done")
        shell.click_target("todo-clear")
        shell.wait_for(lambda: [t["text"] for t in shell.todos()] == ["Charlie"], "only Charlie left")


if __name__ == "__main__":
    unittest.main()
