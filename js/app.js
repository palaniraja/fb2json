/** Brought to you by Palani's 4 weekends in summer'24
 * 
 *  Please Subscribe, Like and click the Bell icon :-P
 */

/**
 * === Globals ===
 */

var jsStdOut = [];
var jsStdErr = [];

// var fileItems = [];

var wasmFSRoot = "/fb2json";
let tmpName = "027059f1d899433da61dcab8076f0fed"; //tmp-name
let tmpBin = `${wasmFSRoot}/${tmpName}.bin`; // wasmFSRoot + "/" + tmpName + ".bin";
let tmpOut = `/${tmpName}.json`; //"/" + tmpName + ".json";

let filesToIgnore = [
    ".",
    "..",
    ".DS_Store",
    wasmFSRoot,
    tmpBin,
    `${tmpName}.bin`,
    tmpOut,
]; //, tmpBin, tmpOut

var droppedFiles = [];
var droppedFileContent = {};
var droppedFilePromises = [];

var folderNames = [];
var processedEntriesCount = 0;

/**
 * === WASM ===
 */

let wasmInstance;
let PATH;

var Module = {
    noInitialRun: true,
    keepRuntimeAlive: true,

    onRuntimeInitialized: function () {
        console.log("Module.onRuntimeInitialized");
    },

    print: function (text) {
        if (arguments.length > 1) {
            text = Array.prototype.slice.call(arguments).join(" ");
        }
        jsStdOut.push(text);
        // console.log(text);
    },

    printErr: function (text) {
        if (arguments.length > 1) {
            text = Array.prototype.slice.call(arguments).join(" ");
        }
        jsStdErr.push(text);
        if (!text.startsWith("program exited (with status: 0)")) {
            console.error(text);
        }
    },

    onExit: function (code) {
        console.log("onExit", code);
    },

    exit: function (msg) {
        console.log("exit called with: ", msg);
    },
};

flatc(Module).then((fObj) => {
    console.log("FLATC loaded");

    wasmInstance = fObj;
    PATH = fObj.PATH;

    fetchVersion();

    setupWasmFS();
    setupDragNDrop();
    loadHistory();
    setupContextMenu();
});

function fetchVersion() {
    let args = ["flatc", "--version"];
    runFlatc(args)
        .then((flatcVersion) => {
            State.version = flatcVersion;
        })
        .catch((error) => {
            console.error(error);
        });
}

function processWithFlatc() {
    let args = [
        "flatc",
        "--json",
        "--defaults-json",
        "--raw-binary",
        "--root-type",
        AppState.selectedTable,
        AppState.selectedFile,
        "--",
        tmpBin,
    ];
    runFlatc(args)
        .then((aout) => {
            // console.log("flatc then called", aout);
            let out = wasmInstance.FS.readFile(tmpOut, { encoding: "utf8" });
            // console.log(out);

            let result = structuredClone(FBHistory);
            result.data = AppUI.dataInput.value;
            result.inputType = State.selectedDataFormat;
            result.fbs = State.selectedFile;
            result.table = State.selectedTable;
            result.json = out;

            // console.log(result)

            prependFBHistory(result);

            let history = localStorage.getItem("fbHistory");
            let items = [];
            if (history) {
                items = JSON.parse(history);
            }
            items.unshift(result);
            localStorage.setItem(
                "fbHistory",
                JSON.stringify(items.slice(0, 5))
            );
            // console.log("updated history with ", items);

            updateUIElement(AppUI.parseButton, "disabled", true);
            updateUIElement(AppUI.dataInput, "value", "");

            wasmInstance.FS.unlink(tmpOut);
            wasmInstance.FS.syncfs(false, (err) => {
                if (err) {
                    throw new Error(err);
                }
            });
        })
        .catch((err) => {
            console.log("processWithFlatc err", err);
            updateUIElement(AppUI.parseButton, "disabled", true);
            State.error = err;
            if (err.status == 0) {
                out = jsStdOut[0];
                console.info(out);
                return out;
            } else {
                console.error(err);
            }
        });
}

function runFlatc(args) {
    return new Promise((resolve, reject) => {
        var argsPtrs = new Array(args.length);
        for (var i = 0; i < args.length; i++) {
            var aPtr = Module._malloc(args[i].length + 1);
            Module.stringToUTF8(args[i], aPtr, args[i].length + 1);
            argsPtrs[i] = aPtr;
        }
        var argValPtr = Module._malloc(argsPtrs.length * 4); // assumes 4 bytes per pointer
        Module.HEAP32.set(argsPtrs, argValPtr / 4); // Copy the array of pointers to the WebAssembly memory

        let result;

        try {
            jsStdOut = []; //reset stdout  before the call
            Module.ccall(
                "main",
                "string",
                ["number", "number"],
                [argsPtrs.length, argValPtr]
            );
            // console.log("ccall is completed");
            resolve();
        } catch (err) {
            // console.log(
            //     "runFlatc returned error with running with arg",
            //     args,
            //     "error:",
            //     err
            // );
            if (err.status == 0) {
                result = jsStdOut[0];
                // console.info(result);
                resolve(result);
            } else {
                console.err(err);
                reject(err);
            }
        }

        argsPtrs.forEach((p) => Module._free(p));
        Module._free(argValPtr);
    });
}

/**
 * === State ===
 */

const FBHistory = {
    table: "",
    inputType: "",
    fbs: "",
    data: "",
    json: "",
};

var AppState = {
    version: "---",
    fbTables: [],
    fbHistory: [],
    info: "",
    error: "",
    selectedDataFormat: "",
    rawData: "",
    fileNameArray: [],
    selectedFile: "",
    selectedTable: "",
};

/**
 * === State Handlers ===
 */

var StateHandler = {
    get: function (target, prop) {
        if (prop in target) {
            return target[prop];
        } else {
            throw new Error(`Property ${prop} does not exist.`);
        }
    },
    set: function (target, prop, value) {
        target[prop] = value;
        // if (prop != "rawData" && prop != "fileNameArray") {
        //     console.info(`Property "${prop}" is set to ${value}`);
        // } else {
        //     console.info(`Property "${prop}" is set ${value.length}`);
        // }

        switch (prop) {
            case "version":
                // uiUpdateVersion(value);
                updateUIElement(AppUI.version, "textContent", value);
                break;
            case "fbTables":
                uiUpdateFBTables(value);
                break;
            case "selectedDataFormat":
                uiUpdateDataFormat(value);
                break;
            case "info":
                uiUpdateInfo(value, true);
                break;
            case "error":
                uiUpdateInfo(value, false);
                break;
            // case "rawData":
            //     uiUpdateUserInput(value);
            //     break;
            case "fileNameArray":
                // uiUpdateExplorerView(value);
                updateUIElement(
                    AppUI.explorer,
                    "innerHTML",
                    generateHTML(value)
                );
                restoreExplorer();

                break;
        }
        return true;
    },
};

var State = new Proxy(AppState, StateHandler);

/**
 * === Reactive UI ===
 */

var AppUI = {
    version: document.querySelector("#flatc-version"),
    tables: document.querySelector("#flatc-tables"),
    info: document.querySelector("#info"),
    selectedDataFormat: document.getElementsByName("format"),
    dataInput: document.querySelector("#userInput"),
    explorer: document.querySelector("#explorer"),
    dialog: document.querySelector("#about-dialog"),
    parseButton: document.querySelector("#parse"),
};

function updateUIElement(el, prop, value, delay) {
    let d = delay || 10;

    setTimeout(() => {
        el[prop] = value;
    }, d);

    // Promise.resolve().then(() => {
    //     el[prop] = value;
    // });
}

function uiUpdateInfo(msg, success) {
    let el = AppUI.info;

    if (success === true) {
        el.classList.remove("info-fail");
        el.classList.add("info-success");
    } else if (success === false) {
        el.classList.remove("info-success");
        el.classList.add("info-fail");
    } else {
        el.classList.remove("info-success");
        el.classList.remove("info-fail");
    }

    updateUIElement(el, "innerHTML", msg);

    let timeout = success ? 2000 : 15000;
    setTimeout(() => {
        el.classList.remove("info-success");
        el.classList.remove("info-fail");
        updateUIElement(el, "innerHTML", "&nbsp;");
    }, timeout);
}

function uiUpdateDataFormat(dataFormat) {
    const radios = Array.from(AppUI.selectedDataFormat);
    const targetRadio = radios.find((radio) => radio.value === dataFormat);
    if (targetRadio) {
        targetRadio.checked = true;
    }
}

function toggleAboutDialog() {
    if (AppUI.dialog.open) {
        AppUI.dialog.close();
    } else {
        AppUI.dialog.showModal();
    }
}

function getSelectedRootValue() {
    var selectedRadio = document.querySelector('input[name="root"]:checked');
    if (selectedRadio) {
        return selectedRadio.value;
    } else {
        return "No radio button is selected";
    }
}

function uiUpdateFBTables(tables) {
    const tmpl = document.querySelector("#fbs-root-template");
    // console.log("No. of tables found in scheme: ", tables.length);
    AppUI.tables.innerHTML = ""; //clear old data
    tables.forEach((t, i) => {
        const tC = tmpl.content.cloneNode(true);

        let inputElement = tC.querySelector(".fbs-root-input");
        let labelElement = tC.querySelector(".fbs-root-label");

        inputElement.value = t;
        labelElement.textContent = t;

        inputElement.id = "input-" + i;
        labelElement.setAttribute("for", "input-" + i);

        // Make the first input element "checked" by default
        if (i === 0) {
            inputElement.checked = true;
            AppState.selectedTable = t;
        }

        AppUI.tables.appendChild(tC);
    });
}

function prependFBHistory(FBHistory) {
    const template = document.getElementById("history-item-template");
    const container = document.getElementById("history-items");

    const newNode = document.importNode(template.content, true);

    newNode.querySelector(".fbs-root").textContent = FBHistory.table;
    newNode.querySelector(".fbs-data-type").textContent = FBHistory.inputType;
    newNode.querySelector(".fbs-file").textContent = FBHistory.fbs.replace(
        wasmFSRoot,
        ""
    );
    newNode.querySelector(".fbs-data").textContent = FBHistory.data;
    newNode.querySelector(".fbs-json").textContent = FBHistory.json; //JSON.stringify(JSON.parse(FBHistory.json), null, '\t');
    container.prepend(newNode);
}

// function uiUpdateExplorerView(files) {
//     AppUI.explorer.innerHTML = generateHTML(files);
// }

/**
 * === UTILS ===
 */
function getCurrentDateFormatted() {
    let date = new Date();
    let year = date.getFullYear();
    let month = ("0" + (date.getMonth() + 1)).slice(-2); // Months are zero indexed, so we add one
    let day = ("0" + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
}

/**
 * === Parsers ===
 */

function extractDetectedRoots(fileContent) {
    let regex = /(?:table|root_type)(\s)(?<available_roots>\w+)/g;
    let match;
    let roots = new Set();
    let default_root = undefined;
    let prioritizedRoots = [];

    while ((match = regex.exec(fileContent)) !== null) {
        if (match[0].startsWith("root_type")) {
            default_root = match.groups.available_roots;
        }
        roots.add(match.groups.available_roots);
    }

    if (default_root) {
        roots.delete(default_root);
    }

    prioritizedRoots = Array.from(roots);

    if (default_root) {
        // 2nd `if` is necessary - to select root element by default if defined
        prioritizedRoots.unshift(default_root);
    }

    return prioritizedRoots;
}

function strippedInput(inputString) {
    return inputString.replace(/[\[\]\(\)\'\"\r\n]/g, "");
}


function autoDetectInputDataFormat(userInput) {
    if (userInput.length < 1) {
        return;
    }

    console.log(`input: [${userInput}]`);

    const intArrayRegex = /^(\d+[\s,]*)+$/;
    if (intArrayRegex.test(userInput)) {
        const intArray = userInput.split(/[\s,]+/).map(Number);
        const uint8Array = Uint8Array.from(intArray);
        return { type: "dec", value: uint8Array };
    }

    //take another pass for base64 by removing newline and spaces
    userInput = userInput.replace(/[\n\s]/g, "");

    console.log(`input-pass2: [${userInput}]`);

    const base64Regex =
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (base64Regex.test(userInput)) {
        const uint8Array = Uint8Array.from(atob(userInput), (c) =>
            c.charCodeAt(0)
        );
        return { type: "base64", value: uint8Array };
    }

    throw new Error("Not a valid BASE64 or Int array");
}

/**
 * === Explorer events ===
 */

function handleDeleteFolder(event, path) {
    opt = confirm(`Delete ${path}?`);
    console.log(opt);
}

function setupDragNDrop() {
    // console.log("setupDragNDrop called");

    let dropzone = document.getElementById("dropzone");
    dropzone.ondragover = function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        this.className = "dropzone dragover";
        return false;
    };

    dropzone.ondragleave = function (e) {
        e.preventDefault();
        this.className = "dropzone";
        return false;
    };

    dropzone.ondrop = function (e) {
        e.preventDefault();
        this.className = "dropzone";

        // droppedFiles = e.dataTransfer.files;
        // console.log("dropped files: ", droppedFiles.length)
        var fileItems = e.dataTransfer.items;

        var dirName = prompt(
            "Directory name for dropped files?",
            getCurrentDateFormatted() + "-"
        );

        let dName = dirName.trim();
        if (dName.length < 1) {
            dName = `${Date.now()}`;
        }

        wasmInstance.FS.mkdir(dName);

        handleFiles(fileItems, dName);
    };
}

function loadHistory() {
    let history = localStorage.getItem("fbHistory");
    if (history) {
        let items = JSON.parse(history);
        items.reverse().forEach((item) => {
            prependFBHistory(item);
        });
    }
}

function selectedFile(event) {
    let filePath = event.target.getAttribute("data-file-name");

    let prevSelected = State.selectedFile;
    if (prevSelected) {
        let lastSelectedElement = document.querySelector(
            `[data-file-name="${prevSelected}"]`
        );
        if (lastSelectedElement) {
            lastSelectedElement.classList.remove("selected-file");
        }
    }

    // Add the 'selected' class to the clicked element
    event.target.classList.add("selected-file");

    let fileContent = readFileContentFromWasm(filePath);
    // State.rawData = fileContent
    State.fbTables = extractDetectedRoots(fileContent);
    State.selectedFile = filePath;
    validateInputs();
}

function validateInputs() {
    if (
        State.selectedFile != "" &&
        State.selectedTable != "" &&
        AppUI.dataInput.value.length > 0 &&
        State.rawData.length > 0
    ) {
        updateUIElement(AppUI.parseButton, "disabled", false);
    }
}

function handleTextInput(event) {
    let data = "";

    if (event.type === "paste") {
        let pasteData = (event.clipboardData || window.clipboardData).getData(
            "text"
        );
        data = pasteData;
    } else if (event.type === "blur") {
        let textareaContent = event.target.value;
        data = textareaContent;
    }

    if (data.length > 0) {
        try {
            let strippedData = strippedInput(data);
            updateUIElement(AppUI.dataInput, "value", strippedData);
            let autoDetect = autoDetectInputDataFormat(strippedData);
            // console.log(autoDetect);
            let dt = autoDetect.type;
            State.selectedDataFormat = dt;
            let infoMsg = "Auto-detected as ";
            if (dt == "base64") {
                infoMsg = infoMsg + dt.toUpperCase();
            } else {
                infoMsg = `${infoMsg} Uint8Array`;
            }
            State.info = infoMsg;
            // AppUI.dataInput.value = strippedData
            State.rawData = autoDetect.value;
            validateInputs();
        } catch (err) {
            console.log(err);
            State.error = `Couldn't detect input data type`;
            updateUIElement(AppUI.parseButton, "disabled", true);
        }
    } else {
        updateUIElement(AppUI.parseButton, "disabled", true);
    }
}

function handleParseData() {
    State.selectedTable = getSelectedRootValue();
    updateUIElement(AppUI.parseButton, "disabled", true);
    try {
        wasmInstance.FS.writeFile(tmpBin, State.rawData, {
            encoding: "binary",
            flags: "w",
        });
        wasmInstance.FS.syncfs(function (err) {
            if (err) {
                throw new Error("Error syncing file system: " + err);
            } else {
                // console.log("File system synced successfully.");
                setTimeout(processWithFlatc, 500);
            }
        });
    } catch (err) {
        console.error("Error handling parse data:", err);
    }
}

function handleFiles(items, dirName) {
    console.log(items.length, " files to be copied to ", dirName);

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.kind === "file") {
            var entry;
            if ("getAsEntry" in item) {
                entry = item.getAsEntry();
            } else if ("webkitGetAsEntry" in item) {
                entry = item.webkitGetAsEntry();
            }
            processEntry(entry, dirName);
        }
    }
}

function processEntry(entry, dirName) {
    if (entry.isFile) {
        entry.file(function (file) {
            if (!filesToIgnore.includes(file.name)) {
                // console.log("Processing file:", file);
                d = file.webkitRelativePath; //file within a dir && vendor specific api but supported everywhere
                var f = d != "" && d != undefined ? d : file.name;
                if (dirName != undefined) {
                    f = dirName + "/" + f;
                }

                droppedFiles.push(f);

                // Process the file here
                var rp = new Promise((resolve, reject) => {
                    let reader = new FileReader();
                    // console.log('trying to read contents: ', f)
                    reader.onload = () => {
                        droppedFileContent[f] = reader.result;
                        // console.log('f =>', f, ' content => ', reader.result)
                        resolve();
                    };
                    reader.onerror = () => {
                        reject(reader.error);
                    };
                    reader.onloadend = () => {
                        // console.log("loading file content complete", f);
                        processedEntriesCount++;
                        updateFilesRead();
                    };
                    reader.readAsText(file);
                });
                droppedFilePromises.push(rp);
            }
        });
    } else if (entry.isDirectory) {
        var reader = entry.createReader();
        reader.readEntries(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                processEntry(entries[i]);
            }
        });
    }
}

/**
 * === WASM FS ===
 */

function setupWasmFS() {
    wasmInstance.FS.mkdir(wasmFSRoot);
    wasmInstance.FS.mount(
        wasmInstance.IDBFS,
        { autoPersist: true, root: wasmFSRoot },
        wasmFSRoot
    );
    listFilesInWasmFS();
}

function updateFilesRead() {
    // console.log(
    //     "processedEntriesCount",
    //     processedEntriesCount,
    //     "droppedFiles.length",
    //     droppedFiles.length
    // );
    if (processedEntriesCount === droppedFiles.length) {
        Promise.all(droppedFilePromises)
            .then(() => {
                // console.log("All dropped files content read");
                writeToIDBFS(droppedFileContent, wasmFSRoot)
                    .then(() =>
                        console.log("All files created successfully in writeToIDBFS")
                    )
                    .catch((err) => console.log("Error creating files:", err));
                setTimeout(listFilesInWasmFS, 2000);
            })
            .catch((error) =>
                console.error("Error trying to read dropped files", error)
            );
    }
}

function writeToIDBFS(droppedFileContent, wasmFSRoot) {
    return new Promise((resolve, reject) => {
        const promises = [];
        for (let filePath in droppedFileContent) {
            promises.push(
                new Promise((resolve, reject) => {
                    const fileContent = droppedFileContent[filePath];
                    const dirs = filePath.split("/");
                    const fileName = dirs.pop();
                    let currentDir = wasmFSRoot;
                    for (let dir of dirs) {
                        currentDir += "/" + dir;
                        try {
                            wasmInstance.FS.mkdir(currentDir);
                        } catch (e) {
                            if (e.code !== "EEXIST") throw e;
                        }
                    }
                    wasmInstance.FS.writeFile(
                        currentDir + "/" + fileName,
                        fileContent,
                        { encoding: "utf8" },
                        function (err) {
                            if (err) {
                                console.log(err);
                                reject(err);
                            } else {
                                resolve();
                            }
                        }
                    );
                })
            );
        }
        Promise.all(promises)
            .then(() => {
                listFilesInWasmFS();
                resolve();
            })
            .catch((err) => {
                console.log(err);
                reject(err);
            });
    });
}

function listFilesInWasmFS() {
    fileNameArray = [];

    wasmInstance.FS.syncfs(true, function (err) {
        if (err) {
            console.log(err);
        } else {
            listFiles(wasmFSRoot, fileNameArray);
            // console.log("called only once?");
            State.fileNameArray = fileNameArray;
        }
    });
}

function listFiles(dir, fileNameArray = []) {
    var list = wasmInstance.FS.readdir(dir);
    list.forEach((f) => {
        if (!filesToIgnore.includes(f)) {
            let path = dir + "/" + f;
            let stat;
            try {
                stat = wasmInstance.FS.stat(path);
            } catch (e) {
                console.log("Error stating file: " + path);
                return;
            }
            if (wasmInstance.FS.isDir(stat.mode)) {
                listFiles(path, fileNameArray); // recursive
            } else {
                fileNameArray.push(path); // a file
            }
        }
    });
    // console.log(fileNameArray);
}

function readFileContentFromWasm(fPath) {
    try {
        let content = wasmInstance.FS.readFile(fPath);
        if (!(content instanceof Uint8Array)) {
            throw new Error("readFile did not return Uint8Array");
        }
        let stringContent = new TextDecoder("utf-8").decode(content);
        return stringContent;
    } catch (e) {
        return "ERR: " + e;
    }
}

function deleteDirectoryRecursively(path) {
    if (wasmInstance.FS.isDir(path)) {
        const entries = wasmInstance.FS.readdir(path);
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (!filesToIgnore.includes(entry)) {
                const fullPath = path + "/" + entry;
                if (wasmInstance.FS.isDir(fullPath)) {
                    deleteDirectoryRecursively(fullPath);
                } else {
                    wasmInstance.FS.unlink(fullPath);
                }
            }
        }
        wasmInstance.FS.rmdir(path);
    } else {
        console.error(`${path} is not a directory`);
    }
}

function deleteAllFilesInPath(path) {
    // Ensure the path exists
    if (!wasmInstance.FS.analyzePath(path).exists) {
        console.error("Path does not exist");
        return;
    }

    // Get the list of files and directories in the path
    var list = wasmInstance.FS.readdir(path);

    // Iterate over each item in the list
    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var itemPath = PATH.join(path, item);

        // Skip the current directory and parent directory symbols
        if (filesToIgnore.includes(item)) {
            continue;
        }

        // Check if the item is a directory or a file
        var stat = wasmInstance.FS.stat(itemPath);
        if (wasmInstance.FS.isDir(stat.mode)) {
            // If it's a directory, recursively delete its contents
            deleteAllFilesInPath(itemPath);
        } else {
            // If it's a file, delete it
            wasmInstance.FS.unlink(itemPath);
        }
    }

    // console.log("going to delete rmdir on ", path);
    wasmInstance.FS.rmdir(path);

    // Synchronize the filesystem with IndexedDB
    wasmInstance.FS.syncfs(false, function (err) {
        if (err) {
            console.error("Error synchronizing filesystem: ", err);
        } else {
            console.log("Filesystem synchronized successfully");
        }
    });
}

/**
 * === UGLY HACKS!!! ===
 */

function restoreExplorer() {
    setTimeout(() => {
        const firstDetails = document.querySelector("#explorer details");
        if (firstDetails) {
            firstDetails.setAttribute("open", "");
            let recentDir = localStorage.getItem("recentDir");
            if (recentDir) {
                const summaries = Array.from(
                    document.querySelectorAll("summary[data-dir-path]")
                );
                let summary = summaries.filter(
                    (summary) =>
                        summary.getAttribute("data-dir-path") == recentDir
                );
                if (summary.length > 0) {
                    summary[0].parentElement.setAttribute("open", "");
                }
            }
        }
    }, 100);
}

function toggleDir(e) {
    if (e.newState == "open") {
        let dirPath = e.target
            .querySelector("summary")
            .getAttribute("data-dir-path");
        localStorage.setItem("recentDir", dirPath);
    }
}

function generateExplorerHTML(map, name, paths = "") {
    let html = "";

    for (let key in map) {
        if (key === "_files") {
            html += "<ul>";
            map[key].forEach((file) => {
                html += `<li class='file-list' onclick="selectedFile(event)" data-file-name="${paths}/${file}">${file}</li>\n`;
            });
            html += "</ul>";
        } else {
            // console.log(paths, "|", key);
            html += `<details onToggle="toggleDir(event)"><summary class="dir" data-dir-path="${paths}/${key}">${key}</summary>`;
            html +=
                "<div>" +
                generateExplorerHTML(map[key], key, paths + `/${key}`) +
                "</div>";
            html += `</details>\n`;
        }
    }

    return html;
}

function generateHTML(fileList) {
    let html = "";
    let directoryMap = {};

    // Create a map of directories and their files
    fileList.forEach((filePath) => {
        let parts = filePath.split("/").slice(1);
        let currentLevel = directoryMap;

        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                if (!currentLevel["_files"]) {
                    currentLevel["_files"] = [];
                }
                currentLevel["_files"].push(part);
            } else {
                // This is a directory
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            }
        });
    });

    html = generateExplorerHTML(directoryMap);
    return html;
}

function deleteDir(target) {
    let dPath = target.getAttribute("data-dir-path");

    console.log("Delete directory:", dPath);
    if (dPath) {
        let ok = confirm(`Delete ${dPath}?`);
        if (ok) {
            target.setAttribute("aria-busy", "true");
            // deleteDirectoryRecursively(dPath);
            deleteAllFilesInPath(dPath);
            setTimeout(listFilesInWasmFS, 3000);
        }
    }
}

function setupContextMenu() {
    const contextMenu = document.getElementById("context-menu");
    let targetElement;
    document.addEventListener("contextmenu", function (event) {
        if (event.target.closest("summary.dir")) {
            event.preventDefault();
            targetElement = event.target.closest("summary.dir");
            if (targetElement.getAttribute("data-dir-path") == wasmFSRoot) {
                contextMenu.style.display = "none";
                return;
            }
            contextMenu.style.display = "block";
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
        } else {
            contextMenu.style.display = "none";
        }
    });

    document.addEventListener("click", function (event) {
        if (event.target.id !== "delete-option") {
            contextMenu.style.display = "none";
        }
    });

    document
        .getElementById("delete-option")
        .addEventListener("click", function (event) {
            contextMenu.style.display = "none";
            deleteDir(targetElement);
        });
}
