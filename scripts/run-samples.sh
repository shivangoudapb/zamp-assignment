#!/usr/bin/env bash
# End-to-end smoke test: resets demo data, then runs every sample invoice through the live pipeline.
# Usage: bash scripts/run-samples.sh [base_url]     (default http://localhost:3000)
# Spaced ~15s apart to stay inside Gemini's free-tier limit of 5 requests/minute.
BASE=${1:-http://localhost:3000}
cd "$(dirname "$0")/.."

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

curl -s -X POST "$BASE/api/reset" | json 'console.log("reset:", JSON.stringify(j))'
for f in happy-acme split-globex duplicate-initech scanned-northwind fraud-stark; do
  id=$(curl -s -F "file=@public/samples/$f.pdf;type=application/pdf" "$BASE/api/runs" | json 'console.log(j.id||("ERR "+j.error))')
  echo "== $f"
  for i in $(seq 1 150); do
    out=$(curl -s "$BASE/api/runs/$id")
    st=$(echo "$out" | json 'console.log(j.run.status)')
    [ "$st" != "running" ] && break
    sleep 1
  done
  echo "$out" | json '
    const r=j.run, x=r.extracted||{};
    console.log(`  ${r.status} -> ${r.decision} in ${(r.duration_ms/1000).toFixed(1)}s | vendor=${r.vendor_name} inv=${r.invoice_number} date=${x.invoice_date} total=${r.total} po=${r.po_number}(${r.po_match_method}) bank=${x.vendor_bank_account} scanned=${x.is_scanned_image}`);
    console.log(`  confidence=${JSON.stringify(x.confidence)}`);
    for (const f of r.reasons) if (f.severity!=="pass") console.log(`   [${f.severity}] ${f.code}: ${f.message}`);
    if (r.error) console.log("  ERROR: "+r.error);'
  sleep 15
done
echo DONE
