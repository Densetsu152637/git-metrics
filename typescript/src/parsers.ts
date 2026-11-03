import { CommandResult, successful } from "./command"
import { last } from "./helpers"
import { 
    FileChanges,
    ChangeType,
    getTypeBy,
} from "./types"


export type Maybe<T> = T | null

export const fromMaybe = <T>(m: Maybe<T>, error: string): T => 
    m === null ? (() => { throw new Error(error); })() : m

export const parse = (s: string) => <T>(parser: (text: string) => Maybe<T>): T => 
    fromMaybe(parser(s), `parser \"${parser.name}\" failed to parse text:\n${s}`)

// parses and executes p at the same time (less efficient if this is called multiple times but has good syntax for inline statements)
export const parsePromise = (p: Promise<string>) => async <T>(parser: (text: string) => Maybe<T>): Promise<T> => 
    parse(await p)(parser)

// executes p and then captures it for use in multiple parsers (more efficient as it does not have multiple executions of the same promise)
export const parsePromiseHold = async (p: Promise<string>): Promise<<T>(parser: (text: string) => Maybe<T>) => T> => {
    const s = await p
    return <T>(parser: (text: string) =>  Maybe<T>): T => parse(s)(parser)
} 

// prioritises stderror, then error, then a successful message
export const getParsableStringFromCmd = (res: CommandResult): string => 
    (res.stdError != null) ? res.stdError : ((res.error != null) ? res.error.message : res.result)

export const parseCmd = (p: Promise<CommandResult>): <T>(parser: (text: string) => Maybe<T>) => Promise<T> => 
    parsePromise(p.then(getParsableStringFromCmd))

export const parseCmdHold = (p: Promise<CommandResult>): Promise<(<T>(parser: (text: string) => Maybe<T>) => T)> => 
    parsePromiseHold(p.then(getParsableStringFromCmd))

export const assertSuccess = (res: CommandResult) => 
    successful(res) ? (() => { throw new Error(getParsableStringFromCmd(res)); })() : null

export const failedOutput = (text: string): boolean => 
    ["fatal:", "error:", "could not", "not a git repository"]
        .map(s => text.startsWith(s))
        .reduce((p, n) => p || n)

export const exactText = (text: string): Maybe<string> => failedOutput(text) ? null : text

export const parseRepoExists = (text: string): Maybe<string> => failedOutput(text) ? null : "repo exists" 

export const parseRepoName = (text: string): Maybe<string> => {
    if (failedOutput(text)) return null

    // Remove possible .git suffix
    const cleanedUrl = text.trim().replace(/\.git$/, '')

    // Extract part after last /
    const parts = cleanedUrl.split('/')

    // Ensure we have enough parts (e.g., https://github.com/user/repo)
    if (parts.length < 1) return null

    return last(parts) || null
}


export const parseContributorEmails = (text: string): Maybe<string[]> => failedOutput(text) ? null : [...new Set(lines(text))]


export const parseRepoBranches = (text: string): Maybe<string[]> => failedOutput(text) ? null : lines(text) // splits on new line
    .filter(l => !l.includes("->")) // doesn't include ref aliases
    .map(line => line.trim().replace(/^\* /, "")) // remove "* " from current branch
    .filter(Boolean); // remove empty lines


export const parseCommitHashes = (text: string): Maybe<string[]> => failedOutput(text) ? null : lines(text) // splits on new line
    .filter(line => !line.startsWith("The system cannot find the path specified.")) // for some reason this exists, but the rest of the logic still works???
    .filter(Boolean); // remove empty lines

type InbetweenCommitData = Readonly<{
    commitHash: string,
    commitTitle: string,
    contributorName: string,
    description: string,
    dateString: string,
    involvedFiles: string[][]
}>

const delim = "\n|||END|||"

// Haskell's `lines`: a trailing newline does not start another line
const lines = (text: string): string[] => {
    if (text === "") return []
    const all = text.split("\n")
    return text.endsWith("\n") ? all.slice(0, -1) : all
}

// Haskell's `words`
const words = (text: string): string[] => text.split(/\s+/).filter(Boolean)

const trimTextWithNewLine = (s: string) => lines(s)
    .map(l => l.trimStart())
    .join("\n")

export const parseCommitData = (text: string): Maybe<InbetweenCommitData> => {
    if (failedOutput(text)) return null

    const blocks = text.split(delim)
    if (blocks.length < 6) return null

    const [commitHash, contributorName, dateString, commitTitle, description] = blocks

    // every name-status line after the last delimiter, split on whitespace
    const involvedFiles = lines(blocks.slice(5).map(b => b + "\n").join(""))
        .filter(l => l !== "")
        .map(words)

    return {
        commitHash: trimTextWithNewLine(commitHash),
        commitTitle: trimTextWithNewLine(commitTitle),
        contributorName: trimTextWithNewLine(contributorName),
        description: trimTextWithNewLine(description),
        dateString: trimTextWithNewLine(dateString),
        involvedFiles
    }
}

type MetaFileChanges = Readonly<{
    filepath: string,
    oldFilePath: string,
    char: ChangeType,
    likeness: number
}>

// parses one whitespace-split name-status line such as ["R100", "old", "new"]
export const parseFileDataFromCommit = (data: string[]): MetaFileChanges => {
    const [changeString, ...rest] = data
    if (changeString === undefined || changeString === "") throw new Error(`Malformed dataList: ${JSON.stringify(data)}`)

    const changeChar = changeString[0]
    const changeType = getTypeBy(changeChar)
    if (changeType === null) throw new Error(`Invalid change type: ${changeChar}`)

    const newFile = last(rest)
    if (newFile === undefined) throw new Error("Missing new file path")

    const oldFile = rest.length > 0 && ["R", "C", "M"].includes(changeType) ? rest[0] : newFile
    const likenessText = changeString.slice(1).replace(/,/g, "").trim()
    const likeness = rest.length > 0 && ["R", "C"].includes(changeType) && /^-?\d+$/.test(likenessText)
        ? Number.parseInt(likenessText, 10)
        : -1

    return { filepath: newFile, oldFilePath: oldFile, char: changeType, likeness }
}

type MetaFileChangesDiff = Readonly<{
    filepath: string,
    diff: string[],
    newLines: number,
    deletedLines: number
}>

const diffHeader = "diff --git "

// `b/<path>` from `diff --git a/<x> b/<path>`, using the last separator that leaves both sides non-empty
const extractFilePath = (header: string): string | null => {
    if (!header.startsWith("diff --git a/")) return null
    const afterA = header.slice("diff --git a/".length)
    for (let index = afterA.lastIndexOf(" b/"); index > 0; index = afterA.lastIndexOf(" b/", index - 1)) {
        if (index + 3 < afterA.length) return afterA.slice(index + 3)
    }
    return null
}

// splits `git diff-tree -p` output into per-file diffs; header lines are excluded from the bodies
export const parseFileDataFromDiff = (text: string): Maybe<MetaFileChangesDiff[]> => {
    if (failedOutput(text)) return null

    const blocks: { header: string, body: string[] }[] = []
    for (const line of lines(text)) {
        if (line.startsWith(diffHeader)) blocks.push({ header: line, body: [] })
        else if (blocks.length > 0) blocks[blocks.length - 1].body.push(line)
    }

    const count = (body: string[], marker: string, excluded: string) =>
        body.filter(l => l.startsWith(marker) && !l.startsWith(excluded)).length

    return blocks.map(({ header, body }) => ({
        filepath: extractFilePath(header) ?? "<unknown>",
        diff: body,
        newLines: count(body, "+", "+++"),
        deletedLines: count(body, "-", "---")
    }))
}

// pairs each name-status record with the diff for its new path (the last diff wins); records without a diff are dropped
export const mergeFileData = (infos: MetaFileChanges[], diffs: MetaFileChangesDiff[]): FileChanges[] => {
    const byPath = new Map(diffs.map(d => [d.filepath, d]))
    return infos.flatMap(info => {
        const diff = byPath.get(info.filepath)
        return diff === undefined ? [] : [{
            filepath: info.filepath,
            oldFilePath: info.oldFilePath,
            char: info.char,
            likeness: info.likeness,
            newLines: diff.newLines,
            deletedLines: diff.deletedLines,
            diff: diff.diff
        }]
    })
}
