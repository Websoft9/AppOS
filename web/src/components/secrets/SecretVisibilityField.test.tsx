import { describe, expect, it } from 'vitest'
import { buildResourceSecretRelationApiPath } from './SecretVisibilityField'

describe('buildResourceSecretRelationApiPath', () => {
  it('uses any-match filtering for multi-select visible_to values', () => {
    expect(
      buildResourceSecretRelationApiPath({
        visibleTo: 'server',
        templateIds: ['single_value', 'ssh_key'],
      }),
    ).toBe(
      "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'||template_id='ssh_key')%26%26(visible_to:length=0||visible_to:each%3F='server')&sort=name",
    )
  })
})