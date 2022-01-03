// @ts-check
import '../typedefs.js'

import { ObjectTypeError } from '../errors/ObjectTypeError.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { assertParameter } from '../utils/assertParameter.js'
import { join } from '../utils/join.js'
import { GitShallowManager } from '../managers/GitShallowManager.js'
import {listBranches} from './listBranches.js'
import { GitAnnotatedTag } from '../models/GitAnnotatedTag.js'
import { GitCommit } from '../models/GitCommit.js'
import { _readObject as readObject } from '../storage/readObject.js'

/**
 * List branches
 *
 * By default it lists local branches. If a 'remote' is specified, it lists the remote's branches. When listing remote branches, the HEAD branch is not filtered out, so it may be included in the list of results.
 *
 * Note that specifying a remote does not actually contact the server and update the list of branches.
 * If you want an up-to-date list, first do a `fetch` to that remote.
 * (Which branch you fetch doesn't matter - the list of branches available on the remote is updated during the fetch handshake.)
 *
 * @param {object} args
 * @param {FsClient} args.fs - a file system client
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.remote] - Instead of the branches in `refs/heads`, list the branches in `refs/remotes/${remote}`.
 *
 * @returns {Promise<{[oid:any]: {children:string[]}}>} Resolves successfully with an array of branch names
 *
 * @example
 * let branches = await git.listBranches({ fs, dir: '/tutorial' })
 * console.log(branches)
 * let remoteBranches = await git.listBranches({ fs, dir: '/tutorial', remote: 'origin' })
 * console.log(remoteBranches)
 *
 */
export async function listCommits({
  fs,
  dir,
  gitdir = join(dir, '.git'),
}) {
    let cache ={}
  try {
    assertParameter('fs', fs)
    assertParameter('gitdir', gitdir)
      const newFS = new FileSystem(fs)

      const start = await listBranches({ fs: newFS, dir, gitdir })
      console.log("got branches", start)
      const finish = []
      const shallows = await GitShallowManager.read({ fs: newFS, gitdir })
      const startingSet = new Set()
      const finishingSet = new Set()
      for (const ref of start) {
          startingSet.add(await GitRefManager.resolve({ fs: newFS, gitdir, ref }))
      }
      for (const ref of finish) {
          // We may not have these refs locally so we must try/catch
          try {
              const oid = await GitRefManager.resolve({ fs: newFS, gitdir, ref })
              finishingSet.add(oid)
          } catch (err) { }
      }
      let visited = {}
      // Because git commits are named by their hash, there is no
      // way to construct a cycle. Therefore we won't worry about
      // setting a default recursion limit.
      async function walk(oid) {
          const { type, object } = await readObject({ fs: newFS, cache, gitdir, oid })
          // Recursively resolve annotated tags
          if (type === 'tag') {
              console.log("got tag", oid)
              const tag = GitAnnotatedTag.from(object)
              const commit = tag.headers().object
              return walk(commit)
          }
          if (type !== 'commit') {
              throw new ObjectTypeError(oid, type, 'commit')
          }
          if (!shallows.has(oid)) {
              const commit = GitCommit.from(object)
              const parents = commit.headers().parent
              for (let parentOid of parents) {
                  console.log("visitng parentoid", parentOid)
                  if (!visited.hasOwnProperty(parentOid)) {
                      await walk(parentOid)
                  }
                  else {
                      console.log("skipping", parentOid)
                  }
                  if (!(parentOid in visited)) {
                      visited[parentOid] = { children: [] }
                  }
                  visited[parentOid].children.push(oid)
              }
          }
      }
      // Let's go walking!
      for (const oid of startingSet) {
          visited[oid] = { children: [] }
          await walk(oid)
      }
      return visited
  } catch (err) {
      err.caller = 'git.listBranches'
      throw err
  }
}
