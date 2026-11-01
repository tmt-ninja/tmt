//! Strict public job-port model for private process fixtures.
pub(super) const PORT: &str = r#"
def job_fail(code):
 save(m);fail(code)
# Public job-port fixture: data is retained under the existing per-test model lock.
def job_row(job,full=False):
 d=job['definition']; owner=d['ownerIdentityId']; room=d['squadRoomId']
 found=next((x for x in m['members'] if x['id']==owner and x['id'] not in m['retired']),None)
 available=found is not None and (room is None or (room==m['room'] and owner not in m['rosterWithout']))
 pause=job['manualPause']; schedule=d['schedule']; next_ms=None
 if available and pause is None and schedule['kind']=='every':
  step=schedule['seconds']*1000; anchor=schedule['anchorMs']; at=m.get('nowMs',100)
  next_ms=anchor+((at-anchor)//step+1)*step
 out={'jobId':job['id'],'displayId':job['displayId'],'revision':job['revision'],'legacy':job['legacy'],
  'target':{'squadRoomId':room,'identityId':owner if available else None,'identityName':found['name'] if available else None},
  'title':d.get('title'),'messagePreview':d['message'].encode()[:256].decode(errors='ignore'),'schedule':schedule,
  'state':'no_owner' if not available else ('paused' if pause else 'on'),'manualPause':pause,'heldSlot':None,
  'routine':'allow','nextRunAtMs':next_ms,'lastRun':None}
 if full: out['definition']=dict(d,pause=pause)
 return out
def job_preview(mutation,at=None):
 kind=mutation['kind']; current=m.setdefault('jobs',{}).get(mutation.get('jobId'))
 if kind not in ['job.add','job.addSquad']:
  if current is None: job_fail('ORCH_JOB_NOT_FOUND')
  if current['revision']!=mutation['revision']: job_fail('ORCH_CONFLICT')
 out={'schemaVersion':1,'configurationRevision':m.get('jobConfigurationRevision',0),'previewAtMs':m.get('nowMs',100) if at is None else at,
  'mutation':mutation,'before':json.loads(json.dumps(current)),'requiresConsent':True}
 if kind=='job.addSquad':
  room=mutation['candidate']['squadRoomId']; out['proposedLegacy']={'roomId':room,'cronId':m.setdefault('jobCounters',{}).get(room,0)+1}
 out['previewDigest']=hashlib.sha256(json.dumps(out,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return out
def job_operation(q,op,i):
 assert not locked,'public jobs operation ran under Ops SQL writer'
 jobs=m.setdefault('jobs',{})
 if op=='orchestration.read':
  if i['view']=='job':
   job=jobs.get(i['jobId'])
   if job is None: job_fail('ORCH_JOB_NOT_FOUND')
   return {'schemaVersion':1,'job':job_row(job,True)}
  assert i['view']=='jobs'
  selected=[job for job in jobs.values() if not i.get('squadRoomId') or job['definition']['squadRoomId']==i['squadRoomId']]
  selected.sort(key=lambda job:int(job['displayId'][1:]))
  offset=int(i.get('cursor') or 0); page=selected[offset:offset+i['limit']]
  return {'schemaVersion':1,'jobs':[job_row(job) for job in page],'nextCursor':str(offset+len(page)) if offset+len(page)<len(selected) else None}
 if op=='orchestration.write':
  mutation=i['mutation']; preview=job_preview(mutation,i.get('previewAtMs'))
  if preview['previewAtMs']>m.get('nowMs',100):job_fail('ORCH_INPUT_INVALID')
  if i['phase']=='preview': return preview
  assert i['phase']=='apply' and i['consent'] is True
  if i['expectedConfigurationRevision']!=preview['configurationRevision'] or i['previewAtMs']!=preview['previewAtMs'] or i['previewDigest']!=preview['previewDigest']:job_fail('ORCH_CONFLICT')
  if m.get('jobApplyFailure'):job_fail(m['jobApplyFailure'])
  kind=mutation['kind']; current=jobs.get(mutation.get('jobId')); before=json.loads(json.dumps(current)); removed=False
  if kind in ['job.add','job.addSquad']:
   definition=mutation['candidate']; owner=definition['ownerIdentityId']
   if owner is not None and owner in m['retired']:job_fail('ORCH_JOB_NO_OWNER')
   number=m.get('jobLastNumber',0)+1; m['jobLastNumber']=number; id=str(uuid.uuid4())
   pause={'by':mutation['pausedBy'],'atMs':preview['previewAtMs']} if mutation.get('pausedBy') else None
   if owner is None and pause is None:pause={'by':'no owner','atMs':preview['previewAtMs']}
   legacy=preview.get('proposedLegacy')
   if legacy:m['jobCounters'][legacy['roomId']]=legacy['cronId']
   current={'id':id,'displayId':'j'+str(number),'revision':1,'definition':definition,'manualPause':pause,'legacy':legacy,'heldSlot':None};jobs[id]=current
  elif kind=='job.rm':del jobs[current['id']];removed=True
  elif kind=='job.pause':
   if current['manualPause'] is None:current['manualPause']={'by':mutation['by'],'atMs':preview['previewAtMs']}
  elif kind=='job.resume':
   if current['definition']['ownerIdentityId'] is None:job_fail('ORCH_JOB_NO_OWNER')
   current['manualPause']=None
  elif kind=='job.set':
   current['definition']=mutation['candidate']
   if current['definition']['ownerIdentityId'] is None and current['manualPause'] is None:current['manualPause']={'by':'no owner','atMs':preview['previewAtMs']}
  else:job_fail('API_INPUT_INVALID')
  changed=removed or current!=before
  if changed:
   if before is not None and not removed:current['revision']+=1
   m['jobConfigurationRevision']=m.get('jobConfigurationRevision',0)+1
  return {'schemaVersion':1,'requiresConsent':False,'configurationRevision':m.get('jobConfigurationRevision',0),'changed':changed,'removed':removed,'job':None if removed else current,'preview':preview}
 if op=='orchestration.job.run':
  job=jobs.get(i['jobId'])
  if job is None:job_fail('ORCH_JOB_NOT_FOUND')
  if job['revision']!=i['revision']:job_fail('ORCH_CONFLICT')
  assert i['consent'] is True and i['manualOperationId']
  if m.get('dispatchRefusal'):job_fail(m['dispatchRefusal'])
  owner=job['definition']['ownerIdentityId']
  if owner is None or owner in m['retired'] or owner in m['rosterWithout']:job_fail('ORCH_JOB_NO_OWNER')
  operation=i['manualOperationId']; intent={'input':{'operationId':operation,'kind':'request','origin':'automation','recipientIds':[owner],'message':job['definition']['message']},'runInput':i,'identity':q.get('identity'),'originator':q.get('originator')}
  previous=m.setdefault('dispatches',{}).get(operation)
  if previous and previous['intent']!=intent:job_fail('DISPATCH_IDEMPOTENCY_CONFLICT')
  receipt=previous['receipt'] if previous else {'operationId':operation,'items':[{'recipientId':owner,'acceptance':'queued','requestId':'req_'+operation}]}
  if not previous:m['dispatches'][operation]={'intent':intent,'receipt':receipt};m.setdefault('wakes',[]).append(operation)
  if m.get('loseResponse'):m['loseResponse']=False;save(m);print('interrupted');sys.exit(0)
  return {'schemaVersion':1,'jobId':job['id'],'outcome':'accepted','created':previous is None,'runId':1,'dispatch':receipt}
 job_fail('API_INPUT_INVALID')
def job_import(args):
 import sqlite3
 if (p/'ops/ops.db').exists():
  probe=sqlite3.connect(str(p/'ops/ops.db'),timeout=0,isolation_level=None)
  try:probe.execute('BEGIN IMMEDIATE');probe.execute('ROLLBACK')
  finally:probe.close()
 m.setdefault('importCommands',[]).append(args)
 receipts=m.setdefault('jobImports',{})
 if args[2]=='import-receipt':
  if m.get('importReadbackFailure'):save(m);job_fail('STORAGE_UNAVAILABLE')
  receipt=receipts.get(args[3])
  if receipt is None:save(m);job_fail('ORCH_JOB_IMPORT_NOT_FOUND')
  if m.get('badImportReceipt'):receipt=dict(receipt,counters={})
  return {'schemaVersion':1,'receipt':receipt}
 assert args[2]=='import'
 source_id=args[args.index('--source-id')+1];digest=args[args.index('--digest')+1]
 raw=pathlib.Path(args[args.index('--file')+1]).read_bytes()
 actual=hashlib.sha256(b'tmt:orchestration:legacy-jobs:v1\0'+len(raw).to_bytes(8,'big')+raw).hexdigest()
 if actual!=digest:save(m);job_fail('ORCH_CONFLICT')
 source=json.loads(raw)
 assert source['version']==2
 if '--yes' not in args:return {'schemaVersion':1,'sourceId':source_id,'sourceDigest':digest,'jobs':len(source['jobs']),'requiresConsent':True}
 if m.get('importFailure'):save(m);job_fail('STORAGE_UNAVAILABLE')
 previous=receipts.get(source_id)
 if previous:
  if previous['sourceDigest']!=digest:save(m);job_fail('ORCH_CONFLICT')
  return {'schemaVersion':1,'requiresConsent':False,'receipt':previous}
 counters=m.setdefault('jobCounters',{})
 if any(room in counters for room in source['counters']):save(m);job_fail('ORCH_CONFLICT')
 jobs=m.setdefault('jobs',{});references=[]
 for legacy in source['jobs']:
  number=m.get('jobLastNumber',0)+1;m['jobLastNumber']=number;id=str(uuid.uuid4());owner=legacy['ownerId'];pause=legacy['pause']
  if owner in m['retired']:
   if pause is None:pause={'by':owner,'atMs':m.get('nowMs',100)}
   owner=None
  definition={'ownerIdentityId':owner,'squadRoomId':legacy['roomId'],'title':None,'message':legacy['message'],'schedule':legacy['schedule']}
  mapping={'roomId':legacy['roomId'],'cronId':int(legacy['id'][1:])}
  jobs[id]={'id':id,'displayId':'j'+str(number),'revision':legacy['revision'],'definition':definition,'manualPause':pause,'legacy':mapping,'heldSlot':None}
  references.append(dict(mapping,jobId=id,displayId='j'+str(number)))
 counters.update(source['counters']);m['jobConfigurationRevision']=m.get('jobConfigurationRevision',0)+1
 receipt={'sourceId':source_id,'sourceDigest':digest,'jobs':references,'counters':source['counters']};receipts[source_id]=receipt
 if m.get('loseImportResponse'):m['loseImportResponse']=False;save(m);print('interrupted');sys.exit(0)
 return {'schemaVersion':1,'requiresConsent':False,'receipt':receipt}
"#;
