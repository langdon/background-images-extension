/*
 * Copyright 2018 Langdon White
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <http://www.gnu.org/licenses/>.
 * 
 * Based on background-logo@fedorahosted.org. All bugs mine. 
 */
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;

const Background = imports.ui.background;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const CalendarImage = new Lang.Class({
    Name: 'CalendarImage',

    _init: function(bgManager) {
        this._bgManager = bgManager;

        this._calendarImageFile = null;

        this._settings = Convenience.getSettings();

        this._settings.connect('changed::calendar-image-file',
                               Lang.bind(this, this._updateLogo));
        this._settings.connect('changed::calendar-image-size',
                               Lang.bind(this, this._updateScale));
        this._settings.connect('changed::calendar-image-position',
                               Lang.bind(this, this._updatePosition));
        this._settings.connect('changed::calendar-image-border',
                               Lang.bind(this, this._updateBorder));
        this._settings.connect('changed::calendar-image-always-visible',
                               Lang.bind(this, this._updateVisibility));

        this._textureCache = St.TextureCache.get_default();
        this._textureCache.connect('texture-file-changed', Lang.bind(this,
            function(cache, file) {
                if (!this._calendarImageFile || !this._calendarImageFile.equal(file))
                    return;
                this._updateLogoTexture();
            }));

        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                     opacity: 0 });
        bgManager._container.add_actor(this.actor);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        let monitorIndex = bgManager._monitorIndex;
        let constraint = new Layout.MonitorConstraint({ index: monitorIndex,
                                                        work_area: true });
        this.actor.add_constraint(constraint);

        this._bin = new St.Widget({ x_expand: true, y_expand: true });
        this.actor.add_actor(this._bin);

        this._settings.bind('calendar-image-opacity', this._bin, 'opacity',
                            Gio.SettingsBindFlags.DEFAULT);

        this._updateLogo();
        this._updatePosition();
        this._updateBorder();

        this._bgDestroyedId =
            bgManager.backgroundActor.connect('destroy',
                                              Lang.bind(this, this._backgroundDestroyed));

        this._bgChangedId =
            bgManager.connect('changed', Lang.bind(this, this._updateVisibility));
        this._updateVisibility();
    },

    _updateLogo: function() {
        let filename = this._settings.get_string('calendar-image-file');
        let file = Gio.File.new_for_commandline_arg(filename);
        if (this._calendarImageFile && this._calendarImageFile.equal(file))
            return;

        this._calendarImageFile = file;

        this._updateLogoTexture();
    },

    _updateLogoTexture: function() {
        if (this._icon)
            this._icon.destroy();

        let scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        if (this._textureCache.load_file_async) { // > 3.14
            this._icon = this._textureCache.load_file_async(this._calendarImageFile, -1, -1, scaleFactor);
        } else { // <= 3.14
            this._icon = this._textureCache.load_uri_async(this._calendarImageFile.get_uri(), -1, -1, scaleFactor);
        }
        this._icon.connect('allocation-changed',
                           Lang.bind(this, this._updateScale));
        this._bin.add_actor(this._icon);
    },

    _updateScale: function() {
        if (this._icon.width == 0)
            return;

        let size = this._settings.get_double('calendar-image-size');
        let width = this.actor.width * size / 100;
        let height = this._icon.height * width / this._icon.width;
        if (Math.abs(this._icon.height - height) < 1.0 &&
            Math.abs(this._icon.width - width) < 1.0) {
            // size of icon would not significantly change, so don't
            // update the size to avoid recursion in case the
            // manually set size differs just minimal from the eventually
            // allocated size
            return;
        }
        this._icon.set_size(width, height);
    },

    _updatePosition: function() {
        let xAlign, yAlign;
        switch (this._settings.get_string('calendar-image-position')) {
            case 'center':
                xAlign = Clutter.ActorAlign.CENTER;
                yAlign = Clutter.ActorAlign.CENTER;
                break;
            case 'bottom-left':
                xAlign = Clutter.ActorAlign.START;
                yAlign = Clutter.ActorAlign.END;
                break;
            case 'bottom-center':
                xAlign = Clutter.ActorAlign.CENTER;
                yAlign = Clutter.ActorAlign.END;
                break;
            case 'bottom-right':
                xAlign = Clutter.ActorAlign.END;
                yAlign = Clutter.ActorAlign.END;
                break;
        }
        this._bin.x_align = xAlign;
        this._bin.y_align = yAlign;
    },

    _updateBorder: function() {
        let border = this._settings.get_uint('calendar-image-border');
        this.actor.style = 'padding: %dpx;'.format(border);
    },

    _updateVisibility: function() {
        let background = this._bgManager.backgroundActor.background._delegate;
        let defaultUri = background._settings.get_default_value('picture-uri');
        let file = Gio.File.new_for_commandline_arg(defaultUri.deep_unpack());

        let visible;
        if (this._settings.get_boolean('calendar-image-always-visible'))
            visible = true;
        else if (background._file) // > 3.14
            visible = background._file.equal(file);
        else if (background._filename) // <= 3.14
            visible = background._filename == file.get_path();
        else // background == NONE
            visible = false;

        Tweener.addTween(this.actor,
                         { opacity: visible ? 255 : 0,
                           time: Background.FADE_ANIMATION_TIME,
                           transition: 'easeOutQuad'
                         });
    },

    _backgroundDestroyed: function() {
        this._bgDestroyedId = 0;

        if (this._bgManager._backgroundSource) // background swapped
            this._bgDestroyedId =
                this._bgManager.backgroundActor.connect('destroy',
                                                        Lang.bind(this, this._backgroundDestroyed));
        else // bgManager destroyed
            this.actor.destroy();
    },

    _onDestroy: function() {
        this._settings.run_dispose();
        this._settings = null;

        if (this._bgDestroyedId)
            this._bgManager.backgroundActor.disconnect(this._bgDestroyedId);
        this._bgDestroyedId = 0;

        if (this._bgChangedId)
            this._bgManager.disconnect(this._bgChangedId);
        this._bgChangedId = 0;

        this._bgManager = null;

        this._calendarImageFile = null;
    }
});


let monitorsChangedId = 0;
let startupPreparedId = 0;
let calendarImages = [];

function forEachBackgroundManager(func) {
    Main.overview._bgManagers.forEach(func);
    Main.layoutManager._bgManagers.forEach(func);
}

function addLogo() {
    destroyLogo();
    forEachBackgroundManager(function(bgManager) {
        calendarImages.push(new CalendarImage(bgManager));
    });
}

function destroyLogo() {
    calendarImages.forEach(function(l) { l.actor.destroy(); });
    calendarImages = [];
}

function init() {
}

function enable() {

    monitorsChangedId = Main.layoutManager.connect('monitors-changed', addLogo);
    startupPreparedId = Main.layoutManager.connect('startup-prepared', addLogo);
    addLogo();
}

function disable() {
    if (monitorsChangedId)
        Main.layoutManager.disconnect(monitorsChangedId);
    monitorsChangedId = 0;

    if (startupPreparedId)
        Main.layoutManager.disconnect(startupPreparedId);
    startupPreparedId = 0;

    destroyLogo();
}
