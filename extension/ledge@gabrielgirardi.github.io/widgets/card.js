import Clutter from 'gi://Clutter';
import St from 'gi://St';

export function cardShell(iconName, title) {
    const card = new St.BoxLayout({vertical: true, style_class: 'ledge-card'});
    const head = new St.BoxLayout({style_class: 'ledge-card-head'});
    card.icon = new St.Icon({icon_name: iconName, style_class: 'ledge-card-icon', y_align: Clutter.ActorAlign.CENTER});
    card.title = new St.Label({text: title, style_class: 'ledge-card-title', y_align: Clutter.ActorAlign.CENTER});
    head.add_child(card.icon);
    head.add_child(card.title);
    card.add_child(head);
    return card;
}
