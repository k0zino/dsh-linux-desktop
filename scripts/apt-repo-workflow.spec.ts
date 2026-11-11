import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { expect, it } from 'vitest'

interface WorkflowStep {
  readonly name?: string
  readonly uses?: string
  readonly run?: string
  readonly if?: string
  readonly env?: Record<string, string>
  readonly with?: Record<string, string>
}

interface Workflow {
  readonly on: Record<string, unknown>
  readonly permissions: Record<string, string>
  readonly concurrency: Record<string, unknown>
  readonly jobs: Record<string, {
    readonly if?: string
    readonly 'runs-on': string
    readonly steps: WorkflowStep[]
  }>
}

const workflow = yaml.load(
  readFileSync(resolve(import.meta.dirname, '../.github/workflows/apt-repo.yml'), 'utf8'),
) as Workflow

it('publishes automatically for Linux release tags and supports manual backfills', () => {
  expect(workflow.on).toMatchObject({
    release: { types: ['published'] },
    workflow_dispatch: { inputs: { release_tag: { required: true } } },
  })
  const publish = workflow.jobs.publish
  expect(publish.if).toContain('vars.APT_GPG_KEY_ID')
  expect(publish.if).toContain("github.event.release.tag_name != 'apt'")
  expect(publish.if).toContain("contains(github.event.release.tag_name, '-linux.')")
  expect(publish['runs-on']).toBe('ubuntu-24.04')
  expect(workflow.permissions).toEqual({ contents: 'write' })
  expect(workflow.concurrency).toEqual({ group: 'apt-repository', 'cancel-in-progress': false })
})

it('checks out the default branch so an old release cannot run an old publisher', () => {
  const checkout = workflow.jobs.publish.steps.find(step => step.uses === 'actions/checkout@v7.0.1')
  expect(checkout?.with?.ref).toBe('${{ github.event.repository.default_branch }}')
  expect(checkout?.with?.['persist-credentials']).toBe(false)
})

it('imports the signing key before running the publisher', () => {
  const steps = workflow.jobs.publish.steps
  const check = steps.findIndex(step => step.name === 'Check signing configuration')
  const publish = steps.findIndex(step => step.name === 'Publish')
  expect(check).toBeGreaterThan(-1)
  expect(check).toBeLessThan(publish)
  expect(steps[check]?.if).toBe("env.APT_REPO_SIGNING != 'false'")
  expect(steps[check]?.run).toContain('gpg --batch --import')
  expect(steps[publish]?.run).toContain('node apt/publish.mjs')
  expect(steps[publish]?.run).toContain('--unsigned')
})
