# Runs the "uploaded" form of each query in DuckDB (transpiled from Trino by sqlglot) against a small
# synthetic dataset: one settled facility with a ZK recovery, one defaulted facility with a cover claim.
# Usage: python check/run_uploaded.py *.sql
import json, re, duckdb, sqlglot
con = duckdb.connect()
con.execute("ATTACH ':memory:' AS dune; CREATE SCHEMA dune.team_param;")
con.execute("""CREATE TABLE dune.team_param.cargoflow_chain_events(tx_hash VARCHAR, log_index INTEGER, block_number BIGINT,
 block_time TIMESTAMP, block_hash VARCHAR, contract VARCHAR, event_name VARCHAR, shipment_id VARCHAR, args VARCHAR)""")
con.execute("""CREATE TABLE dune.team_param.cargoflow_shipments(shipment_id VARCHAR, external_ref VARCHAR, exporter VARCHAR,
 buyer VARCHAR, financier VARCHAR, invoice_value_usdg DOUBLE, route_commitment VARCHAR, route_label VARCHAR,
 requires_zk BOOLEAN, status VARCHAR, created_at TIMESTAMP, updated_at TIMESTAMP)""")
con.execute("""CREATE TABLE dune.team_param.cargoflow_epochs(epoch_id VARCHAR, shipment_id VARCHAR, milestone_index INTEGER,
 sequence INTEGER, score INTEGER, conflict_bps INTEGER, risk_bps INTEGER, compliant BOOLEAN, decision_pass BOOLEAN,
 decision_action VARCHAR, decision_reasons VARCHAR, proof_verified BOOLEAN, reading_count INTEGER, start_time TIMESTAMP,
 end_time TIMESTAMP, lat_e6 INTEGER, lon_e6 INTEGER, max_humidity_x100 INTEGER, max_shock_x100 INTEGER,
 held_distance_m BIGINT, commit_tx_hash VARCHAR, created_at TIMESTAMP)""")
E=[]; n=[0]
def ev(day, hour, contract, name, sid, tx=None, **args):
    n[0]+=1
    E.append((tx or f"0xt{n[0]}", n[0], 1000+n[0], f"2026-09-{day:02d} {hour:02d}:00:00", "0xb", contract, name, sid, json.dumps(args)))
A,B="0xaa","0xbb"; M=10**6
ev(1,0,"FinancingController","FacilityCreated",A,shipmentId=A,financier="0xf1",exporter="0xe1",committed=str(100000*M),feeBps=200,milestoneCount=2)
ev(1,1,"ReceivableVault","CapitalDeposited",A,shipmentId=A,financier="0xf1",amount=str(100000*M))
ev(2,0,"ReceivableVault","AdvanceReleased",A,shipmentId=A,supplier="0xe1",amount=str(60000*M),totalDrawn=str(60000*M))
ev(3,0,"FinancingController","FinancingPaused",A,shipmentId=A,reasonCode="0x01",pausedBy="0xm")
ev(3,5,"EvidenceRegistry","EvidenceProofVerified",None,tx="0xzk",epochId="0xe1")
ev(3,5,"FinancingController","FinancingResumed",A,tx="0xzk",shipmentId=A,resumedBy="0xe1",basis="0xe1")
ev(30,1,"ReceivableVault","FacilitySettled",A,shipmentId=A,principal=str(60000*M),fee=str(2000*M),residual=str(38000*M),undrawnRefund=str(40000*M))
ev(30,1,"FinancingController","StatusChanged",A,shipmentId=A,**{"from":6,"to":7})
ev(1,0,"FinancingController","FacilityCreated",B,shipmentId=B,financier="0xf2",exporter="0xe2",committed=str(50000*M),feeBps=500,milestoneCount=1)
ev(1,2,"CoverPool","CoverOffered",B,shipmentId=B,insurer="0xi1",amount=str(30000*M),premiumBps=200)
ev(1,3,"CoverPool","CoverAccepted",B,shipmentId=B,insurer="0xi1",financier="0xf2",amount=str(30000*M),premium=str(600*M))
ev(1,4,"ReceivableVault","CapitalDeposited",B,shipmentId=B,financier="0xf2",amount=str(50000*M))
ev(2,4,"ReceivableVault","AdvanceReleased",B,shipmentId=B,supplier="0xe2",amount=str(50000*M),totalDrawn=str(50000*M))
ev(4,0,"FinancingController","FinancingPaused",B,shipmentId=B,reasonCode="0x02",pausedBy="0xm")
ev(20,4,"ReceivableVault","FacilityDefaulted",B,shipmentId=B,undrawnRefund="0",outstandingPrincipal=str(50000*M))
ev(20,4,"FinancingController","StatusChanged",B,shipmentId=B,**{"from":4,"to":8})
ev(21,0,"CoverPool","CoverClaimed",B,shipmentId=B,financier="0xf2",insurer="0xi1",loss=str(50000*M),payout=str(30000*M),remainder="0")
ev(21,1,"CoverPool","Withdrawn",None,account="0xf2",amount=str(30000*M))
con.executemany("INSERT INTO dune.team_param.cargoflow_chain_events VALUES (?,?,?,?,?,?,?,?,?)", E)
con.execute("INSERT INTO dune.team_param.cargoflow_shipments VALUES ('0xaa','CF-1','0xe1','0xb1','0xf1',100000,'0xr1','Singapore -> Rotterdam',true,'SETTLED','2026-09-01','2026-09-31'),('0xbb','CF-2','0xe2','0xb2','0xf2',60000,'0xr1','Singapore -> Rotterdam',false,'DEFAULTED','2026-09-01','2026-09-20')".replace('2026-09-31','2026-09-30'))
for i,(sid,c) in enumerate([("0xaa",True),("0xaa",False),("0xaa",True),("0xbb",False)]):
    con.execute(f"INSERT INTO dune.team_param.cargoflow_epochs VALUES ('0xe{i}','{sid}',0,{i},90,0,0,{c},{c},'NONE','',false,10,'2026-09-02','2026-09-02',0,0,5000,120,NULL,'0x','2026-09-02')")
import sys
for path in sys.argv[1:]:
    src=open(path).read().replace('{{team}}','team_param')
    blocks=re.split(r'-- =+ (\w+) \((decoded|uploaded)\)', src)
    for k in range(1,len(blocks),3):
        name,form,body=blocks[k],blocks[k+1],blocks[k+2]
        if form!='uploaded': continue
        q=sqlglot.transpile(body.strip().rstrip(';'), read='trino', write='duckdb')[0]
        rel=con.sql(q); cols=rel.columns; rows=rel.fetchall()
        print(f"--- {name}: {len(rows)} rows")
        for r in rows: print("   ", {c:(round(v,4) if isinstance(v,float) else v) for c,v in zip(cols,r) if v is not None})
