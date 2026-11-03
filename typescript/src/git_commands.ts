
import { Command, logData, doNotLogData } from "./command"


export const checkIfRepoExists = (url: string): Command => ({
    ...doNotLogData,
    cmd: `git ls-remote ${url}`, // tries to get a repo hash from a url
    onSuccess: (command: string)             => `✅ Found Repo ${url}`,
    onFail:    (command: string, error: Error)  => `❌ Could not find Repo ${url}: ${error.message}`
}) 

export const cloneRepo = (url: string, targetDirectory: string): Command => ({
    ...doNotLogData,
    cmd: `git clone --bare ${url} \"${targetDirectory}\"`, // clone only the git metadata to local path
    onSuccess: (command: string)                => `✅ Repo successfully cloned to ${targetDirectory}`,
    onFail:    (command: string, error: Error)  => `❌ Error cloning repo: ${error.message}`
})

export const getBranches = (): Command => ({
    ...doNotLogData,
    cmd: `git --no-pager branch -a --format="%(refname:short)"`, // gets all branch names
})

export const getAllCommitsFrom = (branch: string): Command => ({
    ...doNotLogData,
    cmd: `git --no-pager log --format=%H --end-of-options ${branch} --` // gets all commits from this branch with the full 40 character SHA-1 hash for complete unambiguity
})

export const getContributorEmails = (name: string): Command => ({
    ...doNotLogData,
    cmd: `git log --author="${name}" --pretty=format:"%ae" --`, // gets all contributor emails inside the repo
})

export const getCommitDetails = (hash: string) => ({
    ...doNotLogData,
    cmd: `git show --pretty=format:%H\n|||END|||%an\n|||END|||%cI\n|||END|||%s\n|||END|||%b\n|||END||| --name-status ${hash} --`
})

export const getCommitDiff = (hash: string): Command => ({
    ...doNotLogData,
    cmd: `git --no-pager diff-tree -p ${hash} --` // per-file patches for this commit
})

export const getRepoName = (): Command => ({
    ...doNotLogData,
    cmd: `git remote get-url origin` 
})