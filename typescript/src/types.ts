// Matches the RepositoryData contract of the Haskell and Rust services.

export type RepositoryData = Readonly<{
    repoName: string
    branches: BranchData[]
    allCommits: Map<string, CommitData>
    contributors: Map<string, ContributorData>
}>

export type BranchData = Readonly<{
    branchName: string
    commitHashes: string[]
}>

export type CommitData = Readonly<{
    commitHash: string
    commitTitle: string
    contributorName: string
    description: string
    timestamp: string // committer date as Git prints it (%cI)
    fileData: FileChanges[]
}>

export type ContributorData = Readonly<{
    name: string
    emails: string[]
}>

export type FileChanges = Readonly<{
    filepath: string
    oldFilePath: string
    char: ChangeType
    likeness: number
    newLines: number
    deletedLines: number
    diff: string[]
}>

export type ChangeType = "A" | "M" | "D" | "R" | "C"

export const getTypeBy = (c: string): ChangeType | null => {
    switch (c) {
        case "A" :
        case "D" :
        case "M" :
        case "R" :
        case "C" : return c
        default  : return null
    }
}

// newest first by timestamp text; ties keep Git's order (Array.prototype.sort is stable)
export const sortCommitByTimeStamp = (c1: CommitData, c2: CommitData): number =>
    c2.timestamp < c1.timestamp ? -1 : c2.timestamp > c1.timestamp ? 1 : 0
