import { randomUUID } from 'node:crypto'
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLList,
  GraphQLBoolean,
  GraphQLNonNull,
  GraphQLEnumType,
} from 'graphql'
import type { JobQueue } from '../services/job-queue.js'
import type { ScanRegistry } from '../services/scan-registry.js'
import { assertValidRepoUrl } from '../middleware/validate-url.js'

export type GraphQLContext = {
  registry: ScanRegistry
  queue: JobQueue
}

const ScanStatusEnum = new GraphQLEnumType({
  name: 'ScanStatus',
  values: {
    Queued: { value: 'Queued' },
    Scanning: { value: 'Scanning' },
    Finished: { value: 'Finished' },
    Failed: { value: 'Failed' },
  },
})

const ScanErrorType = new GraphQLObjectType({
  name: 'ScanError',
  fields: {
    code: { type: new GraphQLNonNull(GraphQLString) },
    message: { type: new GraphQLNonNull(GraphQLString) },
  },
})

const VulnerabilityType = new GraphQLObjectType({
  name: 'Vulnerability',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    package: { type: new GraphQLNonNull(GraphQLString) },
    installedVersion: { type: new GraphQLNonNull(GraphQLString) },
    fixedVersion: { type: GraphQLString },
    severity: { type: new GraphQLNonNull(GraphQLString) },
    title: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
  },
})

const ScanType = new GraphQLObjectType({
  name: 'Scan',
  fields: {
    id: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (scan) => scan.scanId as string,
    },
    repoUrl: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(ScanStatusEnum) },
    criticalVulnerabilities: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(VulnerabilityType))),
      resolve: (scan) => scan.status === 'Finished' ? scan.vulnerabilities : [],
    },
    truncated: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (scan) => scan.truncated ?? false,
    },
    error: {
      type: ScanErrorType,
      resolve: (scan) => scan.status === 'Failed' ? scan.error : null,
    },
    createdAt: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (scan) => (scan.createdAt as Date).toISOString(),
    },
    updatedAt: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (scan) => (scan.updatedAt as Date).toISOString(),
    },
  },
})

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    scan: {
      type: ScanType,
      args: {
        id: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_root, args: { id: string }, ctx: GraphQLContext) => {
        return ctx.registry.get(args.id) ?? null
      },
    },
  },
})

const StartScanResultType = new GraphQLObjectType({
  name: 'StartScanResult',
  fields: {
    scanId: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: new GraphQLNonNull(ScanStatusEnum) },
  },
})

const StartScanErrorType = new GraphQLObjectType({
  name: 'StartScanError',
  fields: {
    message: { type: new GraphQLNonNull(GraphQLString) },
  },
})

const MutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    startScan: {
      type: new GraphQLNonNull(new GraphQLObjectType({
        name: 'StartScanPayload',
        fields: {
          scan: { type: StartScanResultType },
          error: { type: StartScanErrorType },
        },
      })),
      args: {
        repoUrl: { type: new GraphQLNonNull(GraphQLString) },
      },
      resolve: (_root, args: { repoUrl: string }, ctx: GraphQLContext) => {
        const urlError = assertValidRepoUrl(args.repoUrl)
        if (urlError) {
          return { scan: null, error: { message: urlError } }
        }

        const scanId = randomUUID()
        ctx.registry.create(scanId, args.repoUrl)

        const enqueued = ctx.queue.enqueue({ scanId, repoUrl: args.repoUrl })
        if (!enqueued) {
          ctx.registry.setError(scanId, {
            code: 'UNKNOWN',
            message: 'Queue is full',
          })
          return {
            scan: null,
            error: { message: 'Queue is full. Try again later.' },
          }
        }

        return {
          scan: { scanId, status: 'Queued' },
          error: null,
        }
      },
    },
  },
})

export const schema = new GraphQLSchema({
  query: QueryType,
  mutation: MutationType,
})
