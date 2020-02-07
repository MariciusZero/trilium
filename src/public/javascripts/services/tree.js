import ws from './ws.js';
import protectedSessionHolder from './protected_session_holder.js';
import utils from './utils.js';
import server from './server.js';
import treeCache from './tree_cache.js';
import toastService from "./toast.js";
import treeBuilder from "./tree_builder.js";
import hoistedNoteService from '../services/hoisted_note.js';
import optionsService from "../services/options.js";
import bundle from "./bundle.js";
import appContext from "./app_context.js";

/**
 * Accepts notePath which might or might not be valid and returns an existing path as close to the original
 * notePath as possible.
 * @return {string|null}
 */
async function resolveNotePath(notePath) {
    const runPath = await getRunPath(notePath);

    return runPath ? runPath.join("/") : null;
}

/**
 * Accepts notePath and tries to resolve it. Part of the path might not be valid because of note moving (which causes
 * path change) or other corruption, in that case this will try to get some other valid path to the correct note.
 *
 * @return {string[]}
 */
async function getRunPath(notePath) {
    utils.assertArguments(notePath);

    notePath = notePath.split("-")[0].trim();

    if (notePath.length === 0) {
        return;
    }

    const path = notePath.split("/").reverse();

    if (!path.includes("root")) {
        path.push('root');
    }

    const hoistedNoteId = await hoistedNoteService.getHoistedNoteId();

    const effectivePath = [];
    let childNoteId = null;
    let i = 0;

    while (true) {
        if (i >= path.length) {
            break;
        }

        const parentNoteId = path[i++];

        if (childNoteId !== null) {
            const child = await treeCache.getNote(childNoteId);

            if (!child) {
                console.log("Can't find note " + childNoteId);
                return;
            }

            const parents = await child.getParentNotes();

            if (!parents) {
                ws.logError("No parents found for " + childNoteId);
                return;
            }

            if (!parents.some(p => p.noteId === parentNoteId)) {
                console.debug(utils.now(), "Did not find parent " + parentNoteId + " for child " + childNoteId);

                if (parents.length > 0) {
                    console.debug(utils.now(), "Available parents:", parents);

                    const someNotePath = await getSomeNotePath(parents[0]);

                    if (someNotePath) { // in case it's root the path may be empty
                        const pathToRoot = someNotePath.split("/").reverse();

                        for (const noteId of pathToRoot) {
                            effectivePath.push(noteId);
                        }

                        effectivePath.push('root');
                    }

                    break;
                }
                else {
                    ws.logError("No parents, can't activate node.");
                    return;
                }
            }
        }

        effectivePath.push(parentNoteId);
        childNoteId = parentNoteId;

        if (parentNoteId === hoistedNoteId) {
            break;
        }
    }

    return effectivePath.reverse();
}

async function getSomeNotePath(note) {
    utils.assertArguments(note);

    const path = [];

    let cur = note;

    while (cur.noteId !== 'root') {
        path.push(cur.noteId);

        const parents = await cur.getParentNotes();

        if (!parents.length) {
            console.error(`Can't find parents for note ${cur.noteId}`);
            return;
        }

        cur = parents[0];
    }

    path.push('root');

    return path.reverse().join('/');
}

async function sortAlphabetically(noteId) {
    await server.put('notes/' + noteId + '/sort');
}

ws.subscribeToMessages(message => {
   if (message.type === 'open-note') {
       appContext.tabManager.activateOrOpenNote(message.noteId);

       if (utils.isElectron()) {
           const currentWindow = require("electron").remote.getCurrentWindow();

           currentWindow.show();
       }
   }
});

async function getParentProtectedStatus(node) {
    return await hoistedNoteService.isRootNode(node) ? 0 : node.getParent().data.isProtected;
}

function getNoteIdFromNotePath(notePath) {
    if (!notePath) {
        return null;
    }

    const path = notePath.split("/");

    const lastSegment = path[path.length - 1];

    // path could have also tabId suffix
    return lastSegment.split("-")[0];
}

function getNoteIdAndParentIdFromNotePath(notePath) {
    let parentNoteId = 'root';
    let noteId = '';

    if (notePath) {
        const path = notePath.split("/");

        const lastSegment = path[path.length - 1];

        // path could have also tabId suffix
        noteId = lastSegment.split("-")[0];

        if (path.length > 1) {
            parentNoteId = path[path.length - 2];
        }
    }

    return {
        parentNoteId,
        noteId
    }
}

async function getNotePath(node) {
    if (!node) {
        console.error("Node is null");
        return "";
    }

    const path = [];

    while (node && !await hoistedNoteService.isRootNode(node)) {
        if (node.data.noteId) {
            path.push(node.data.noteId);
        }

        node = node.getParent();
    }

    if (node) { // null node can happen directly after unhoisting when tree is still hoisted but option has been changed already
        path.push(node.data.noteId); // root or hoisted noteId
    }

    return path.reverse().join("/");
}

async function getNoteTitle(noteId, parentNoteId = null) {
    utils.assertArguments(noteId);

    const note = await treeCache.getNote(noteId);
    if (!note) {
        return "[not found]";
    }

    let {title} = note;

    if (parentNoteId !== null) {
        const branchId = note.parentToBranch[parentNoteId];

        if (branchId) {
            const branch = treeCache.getBranch(branchId);

            if (branch && branch.prefix) {
                title = branch.prefix + ' - ' + title;
            }
        }
    }

    return title;
}

async function getNotePathTitle(notePath) {
    utils.assertArguments(notePath);

    const titlePath = [];

    if (notePath.startsWith('root/')) {
        notePath = notePath.substr(5);
    }

    // special case when we want just root's title
    if (notePath === 'root') {
        return await getNoteTitle(notePath);
    }

    let parentNoteId = 'root';

    for (const noteId of notePath.split('/')) {
        titlePath.push(await getNoteTitle(noteId, parentNoteId));

        parentNoteId = noteId;
    }

    return titlePath.join(' / ');
}

export default {
    sortAlphabetically,
    resolveNotePath,
    getSomeNotePath,
    getRunPath,
    getParentProtectedStatus,
    getNotePath,
    getNoteIdFromNotePath,
    getNoteIdAndParentIdFromNotePath,
    getNoteTitle,
    getNotePathTitle
};