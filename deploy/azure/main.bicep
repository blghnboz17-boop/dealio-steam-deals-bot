
targetScope = 'resourceGroup'
@description('Must be confirmed against the signed-in account before deployment.')
@allowed([true])
param azureCreditVerified bool
param applicationId string
param vmPrincipalId string
param actionGroupId string
param location string = resourceGroup().location
param siteLocation string = 'westeurope'
param storageName string = 'dealio${uniqueString(resourceGroup().id)}'
var columns = [
  { name: 'TimeGenerated', type: 'datetime' }
  { name: 'Application', type: 'string' }
  { name: 'HeartbeatAgeSeconds', type: 'real' }
  { name: 'DiscordReady', type: 'boolean' }
  { name: 'ScanAgeSeconds', type: 'real' }
  { name: 'QueueAgeSeconds', type: 'real' }
  { name: 'BackupAgeSeconds', type: 'real' }
  { name: 'BackupOk', type: 'boolean' }
]
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    encryption: {
      keySource: 'Microsoft.Storage'
      services: { blob: { enabled: true, keyType: 'Account' } }
    }
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: false
    deleteRetentionPolicy: { enabled: false }
    containerDeleteRetentionPolicy: { enabled: false }
  }
}
resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for name in ['leases','backups']: {
  parent: blobs
  name: name
  properties: { publicAccess: 'None' }
}]
resource retention 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [{
        name: 'backup-seven-days'
        enabled: true
        type: 'Lifecycle'
        definition: {
          filters: { blobTypes: ['blockBlob'], prefixMatch: ['backups/daily/'] }
          actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 7 } } }
        }
      }]
    }
  }
}
resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id,vmPrincipalId,'blob-data')
  scope: storage
  properties: {
    principalId: vmPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'dealio-health'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: json('0.1') } }
}
resource table 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = {
  parent: workspace
  name: 'DealioHealth_CL'
  properties: { plan: 'Analytics', retentionInDays: 30, schema: { name: 'DealioHealth_CL', columns: columns } }
}
resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2022-06-01' = {
  name: 'dealio-health-ingestion'
  location: location
  properties: { networkAcls: { publicNetworkAccess: 'Enabled' } }
}
resource collection 'Microsoft.Insights/dataCollectionRules@2022-06-01' = {
  name: 'dealio-health'
  location: location
  properties: {
    dataCollectionEndpointId: endpoint.id
    streamDeclarations: { 'Custom-DealioHealth': { columns: columns } }
    destinations: { logAnalytics: [{ name: 'health', workspaceResourceId: workspace.id }] }
    dataFlows: [{ streams: ['Custom-DealioHealth'], destinations: ['health'], transformKql: 'source', outputStream: 'Custom-DealioHealth_CL' }]
  }
  dependsOn: [table]
}
resource monitorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(collection.id,vmPrincipalId,'monitor-publisher')
  scope: collection
  properties: {
    principalId: vmPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions','3913510d-42f4-4e42-8a64-420c390055eb')
  }
}
var conditions = [
  { name: 'heartbeat', where: 'isnull(TimeGenerated) or HeartbeatAgeSeconds > 180 or DiscordReady == false' }
  { name: 'stale-scans', where: 'ScanAgeSeconds > 7200' }
  { name: 'delivery-queue', where: 'QueueAgeSeconds > 93600' }
  { name: 'backup', where: 'BackupAgeSeconds > 93600 or BackupOk == false' }
]
resource alerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for item in conditions: {
  name: 'dealio-${item.name}'
  location: location
  properties: {
    displayName: 'Dealio ${item.name}'
    enabled: true
    severity: 1
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [workspace.id]
    criteria: {
      allOf: [{
        query: 'datatable(Application:string) ["${applicationId}"] | join kind=leftouter (DealioHealth_CL | where TimeGenerated > ago(10m) | summarize arg_max(TimeGenerated, *) by Application) on Application | where ${item.where}'
        timeAggregation: 'Count'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: [actionGroupId] }
    autoMitigate: true
  }
  dependsOn: [table]
}]
resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'dealio-public'
  location: siteLocation
  sku: { name: 'Free', tier: 'Free' }
  properties: { stagingEnvironmentPolicy: 'Enabled', allowConfigFileUpdates: true }
}
output leaseContainerUrl string = '${storage.properties.primaryEndpoints.blob}leases'
output backupContainerUrl string = '${storage.properties.primaryEndpoints.blob}backups'
output monitorEndpoint string = endpoint.properties.logsIngestion.endpoint
output monitorRuleId string = collection.properties.immutableId
output publicUrl string = 'https://${site.properties.defaultHostname}'
output creditConfirmed bool = azureCreditVerified
