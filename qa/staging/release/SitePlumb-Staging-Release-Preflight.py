#!/usr/bin/env python3
"""Staging settings only. No database data, deployments, writes or tokens printed."""
import json
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone

PROJECT = 'siteplumb-staging'
NUMBER = '625071693246'
ACCOUNT = 'siteplumb-packets@siteplumb-staging.iam.gserviceaccount.com'

def main():
    result = {'mode': 'READ_ONLY', 'target': PROJECT, 'expected_project_number': NUMBER,
              'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'observations': {}}
    try:
        token = subprocess.check_output(['gcloud', 'auth', 'print-access-token', '--project=' + PROJECT],
                                        text=True, stderr=subprocess.DEVNULL).strip()
    except subprocess.CalledProcessError:
        result.update(status='BLOCKED', error='Cloud Shell authorization unavailable; no cloud request made.')
        print(json.dumps(result, indent=2))
        return

    def read(url, body=None):
        request = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(),
                  headers={'Authorization': 'Bearer ' + token, 'x-goog-user-project': PROJECT,
                           'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            return {'error': 'HTTP ' + str(error.code)}
        except Exception:
            return {'error': 'Request could not be completed'}

    identity = read('https://cloudresourcemanager.googleapis.com/v1/projects/' + PROJECT)
    if identity.get('projectId') != PROJECT or str(identity.get('projectNumber')) != NUMBER or identity.get('lifecycleState') != 'ACTIVE':
        result.update(status='BLOCKED', error='Project identity could not be verified', identity=identity.get('error', 'Mismatch'))
        print(json.dumps(result, indent=2))
        return
    obs = result['observations']
    obs['project_identity'] = 'MATCH'
    database = read('https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)')
    obs['database'] = {k: database[k] for k in ['name', 'locationId', 'type', 'error'] if k in database}
    billing = read('https://cloudbilling.googleapis.com/v1/projects/' + PROJECT + '/billingInfo')
    obs['billing'] = {k: billing[k] for k in ['billingEnabled', 'error'] if k in billing}
    account = read('https://iam.googleapis.com/v1/projects/' + PROJECT + '/serviceAccounts/' + ACCOUNT)
    obs['runtime_account'] = {k: account[k] for k in ['email', 'disabled', 'error'] if k in account}
    # getIamPolicy is a read operation despite its POST transport. Filter out human identities.
    policy = read('https://cloudresourcemanager.googleapis.com/v1/projects/' + PROJECT + ':getIamPolicy', {})
    obs['runtime_roles'] = {'error': policy['error']} if 'error' in policy else [
        {'role': b['role'], 'conditional': bool(b.get('condition'))}
        for b in policy.get('bindings', []) if 'serviceAccount:' + ACCOUNT in b.get('members', [])]
    function = read('https://cloudfunctions.googleapis.com/v2/projects/' + PROJECT + '/locations/us-central1/functions/packetCommand')
    obs['callable'] = {'error': function['error']} if 'error' in function else {
        'name': function.get('name'), 'state': function.get('state'),
        'runtime': function.get('buildConfig', {}).get('runtime'),
        'runtime_account': function.get('serviceConfig', {}).get('serviceAccountEmail'),
        'service': function.get('serviceConfig', {}).get('service')}
    releases = read('https://firebasehosting.googleapis.com/v1beta1/sites/' + PROJECT + '/releases?pageSize=1')
    obs['hosting'] = {'error': releases['error']} if 'error' in releases else {
        'latest_release': [{k: r[k] for k in ['name', 'type', 'releaseTime'] if k in r} for r in releases.get('releases', [])]}
    result['status'] = 'SETTINGS_COLLECTED'
    result['note'] = 'Errors or missing fields remain unverified. No IAM grants, accounts, data, rules or deployments changed. Full baseline snapshots and browser QA remain pending.'
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
