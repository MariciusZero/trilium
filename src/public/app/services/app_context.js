import treeCache from "./tree_cache.js";
import bundleService from "./bundle.js";
import DialogCommandExecutor from "./dialog_command_executor.js";
import Entrypoints from "./entrypoints.js";
import options from "./options.js";
import utils from "./utils.js";
import ZoomService from "./zoom.js";
import TabManager from "./tab_manager.js";
import treeService from "./tree.js";
import Component from "../widgets/component.js";
import keyboardActionsService from "./keyboard_actions.js";
import MobileScreenSwitcherExecutor from "../widgets/mobile_widgets/mobile_screen_switcher.js";
import MainTreeExecutors from "./main_tree_executors.js";

class AppContext extends Component {
    constructor(isMainWindow) {
        super();

        this.isMainWindow = isMainWindow;
    }

    setLayout(layout) {
        this.layout = layout;
    }

    async start() {
        await Promise.all([treeCache.initializedPromise, options.initializedPromise]);

        $("#loading-indicator").hide();

        this.showWidgets();

        this.tabManager.loadTabs();

        if (utils.isDesktop()) {
            setTimeout(() => bundleService.executeStartupBundles(), 2000);
        }
    }

    showWidgets() {
        const rootWidget = this.layout.getRootWidget(this);
        const $renderedWidget = rootWidget.render();

        keyboardActionsService.updateDisplayedShortcuts($renderedWidget);

        $("body").append($renderedWidget);

        $renderedWidget.on('click', "[data-trigger-command]", e => {
            const commandName = $(e.target).attr('data-trigger-command');

            this.triggerCommand(commandName);
        });

        this.tabManager = new TabManager();

        this.executors = [
            this.tabManager,
            new DialogCommandExecutor(),
            new Entrypoints(),
            new MainTreeExecutors()
        ];

        if (utils.isMobile()) {
            this.executors.push(new MobileScreenSwitcherExecutor());
        }

        this.child(rootWidget);

        for (const executor of this.executors) {
            this.child(executor);
        }

        if (utils.isElectron()) {
            this.child(new ZoomService());
        }

        this.triggerEvent('initialRenderComplete');
    }

    /** @return {Promise} */
    triggerEvent(name, data) {
        return this.handleEvent(name, data);
    }

    /** @return {Promise} */
    triggerCommand(name, data = {}) {
        for (const executor of this.executors) {
            const fun = executor[name + "Command"];

            if (fun) {
                return executor.callMethod(fun, data);
            }
        }

        console.debug(`Unhandled command ${name}, converting to event.`);

        return this.triggerEvent(name, data);
    }

    getComponentByEl(el) {
        return $(el).closest(".component").prop('component');
    }

    async openInNewWindow(notePath) {
        if (utils.isElectron()) {
            const {ipcRenderer} = utils.dynamicRequire('electron');

            ipcRenderer.send('create-extra-window', {notePath});
        }
        else {
            const url = window.location.protocol + '//' + window.location.host + window.location.pathname + '?extra=1#' + notePath;

            window.open(url, '', 'width=1000,height=800');
        }
    }
}

const appContext = new AppContext(window.glob.isMainWindow);

// we should save all outstanding changes before the page/app is closed
$(window).on('beforeunload', () => {
    appContext.triggerEvent('beforeUnload');
});

function isNotePathInAddress() {
    const [notePath, tabId] = treeService.getHashValueFromAddress();

    return notePath.startsWith("root")
        // empty string is for empty/uninitialized tab
        || (notePath === '' && !!tabId);
}

$(window).on('hashchange', function() {
    if (isNotePathInAddress()) {
        const [notePath, tabId] = treeService.getHashValueFromAddress();

        if (!notePath) {
            console.log(`Invalid hash value "${document.location.hash}", ignoring.`);
            return;
        }

        appContext.tabManager.switchToTab(tabId, notePath);
    }
});

export default appContext;