# =============================================================================
#  Tally test-import — run this ON the client's server, in PowerShell.
#
#      powershell -ExecutionPolicy Bypass -File tally-test.ps1
#
#  It refuses to import anything unless PRATHAM TEST COMPANY is the company
#  Tally reports. The client's live books are never a possible target.
#
#  Copy the whole output back to Claude.
# =============================================================================

$TallyUrl = "http://localhost:9000"
$TestCompany = "PRATHAM TEST COMPANY"

function Send-Tally([string]$Xml, [int]$TimeoutSec = 120) {
    try {
        $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($Xml)
        $req = [System.Net.HttpWebRequest]::Create($TallyUrl)
        $req.Method = "POST"
        $req.ContentType = "text/xml;charset=windows-1252"
        $req.Timeout = $TimeoutSec * 1000
        $req.ReadWriteTimeout = $TimeoutSec * 1000
        $req.ContentLength = $bytes.Length
        $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::GetEncoding(1252))
        $out = $reader.ReadToEnd(); $reader.Close(); $resp.Close()
        return $out
    } catch { return "ERROR: $($_.Exception.Message)" }
}

Write-Host ""
Write-Host "=============================================================="
Write-Host " STEP 1 - which company does Tally report?"
Write-Host "=============================================================="

$companiesXml = @'
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>C</ID></HEADER><BODY><DESC><TDL><TDLMESSAGE><COLLECTION NAME="C" ISINITIALIZE="Yes"><TYPE>Company</TYPE><NATIVEMETHOD>Name</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
'@

$r = Send-Tally $companiesXml 60
$names = [regex]::Matches($r, '<COMPANY NAME="([^"]*)"') | ForEach-Object { $_.Groups[1].Value }
if ($names.Count -eq 0) { Write-Host "  (none reported)"; Write-Host "  raw: $($r.Substring(0, [Math]::Min(300, $r.Length)))" }
foreach ($n in $names) { Write-Host "  loaded: $n" }

Write-Host ""
Write-Host "=============================================================="
Write-Host " SAFETY GATE"
Write-Host "=============================================================="

$onlyTest = ($names.Count -eq 1) -and ($names[0].Trim() -eq $TestCompany)
if (-not $onlyTest) {
    Write-Host ""
    Write-Host "  STOPPED. Not importing." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Tally must report exactly one loaded company, and it must be:"
    Write-Host "    $TestCompany"
    Write-Host ""
    Write-Host "  In Tally: close every other company (K: Company - Close),"
    Write-Host "  make sure no other user is connected, then run this again."
    Write-Host ""
    exit 1
}
Write-Host "  OK - only $TestCompany is loaded. Safe to import."

Write-Host ""
Write-Host "=============================================================="
Write-Host " STEP 2 - import invoice T/2982/2026-27 (first time)"
Write-Host "=============================================================="

$invoiceXml = @'
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>PRATHAM TEST COMPANY</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH" ACTION="Create"><NAME>KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH</NAME><PARENT>Sundry Debtors</PARENT><ISBILLWISEON>Yes</ISBILLWISEON><PARTYGSTIN>27AAAAK8694F2Z9</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><LEDSTATENAME>Maharashtra</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME></LEDGER></TALLYMESSAGE><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME=".FREIGHT CHARGES" ACTION="Create"><NAME>.FREIGHT CHARGES</NAME><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="LOLO CHARGES" ACTION="Create"><NAME>LOLO CHARGES</NAME><PARENT>Sales Accounts</PARENT></LEDGER></TALLYMESSAGE><TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="OUTPUT IGST@18 %" ACTION="Create"><NAME>OUTPUT IGST@18 %</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD><AFFECTSSTOCK>No</AFFECTSSTOCK></LEDGER></TALLYMESSAGE><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View"><REMOTEID>TMS-INV-44</REMOTEID><DATE>20260814</DATE><EFFECTIVEDATE>20260814</EFFECTIVEDATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>T/2982/2026-27</VOUCHERNUMBER><REFERENCE>T/2982/2026-27</REFERENCE><REFERENCEDATE>20260814</REFERENCEDATE><ISINVOICE>Yes</ISINVOICE><PARTYLEDGERNAME>KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH</PARTYLEDGERNAME><PARTYNAME>KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH</PARTYNAME><BASICBUYERNAME>KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH</BASICBUYERNAME><PARTYGSTIN>27AAAAK8694F2Z9</PARTYGSTIN><STATENAME>Maharashtra</STATENAME><PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY><COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE><NARRATION>NHAVA SHEVA - KHATRAJ - NHAVA SHEVA</NARRATION><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ALLLEDGERENTRIES.LIST><LEDGERNAME>KAIRA DISTRICT CO-OP MILK PRODUCERS UNION LTD - MH</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-98176.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>.FREIGHT CHARGES</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>80000.00</AMOUNT><REMARKS>Freight Charges</REMARKS><GSTOVRDNHSNSACDETAILS.LIST><HSNCODE>99651100</HSNCODE></GSTOVRDNHSNSACDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>GST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>LOLO CHARGES</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>3200.00</AMOUNT><REMARKS>Lolo Income</REMARKS><GSTOVRDNHSNSACDETAILS.LIST><HSNCODE>996711</HSNCODE></GSTOVRDNHSNSACDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>GST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>OUTPUT IGST@18 %</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>14976.00</AMOUNT><RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
'@

$r1 = Send-Tally $invoiceXml 180
Write-Host $r1

Write-Host ""
Write-Host "=============================================================="
Write-Host " STEP 3 - import the SAME invoice again (REMOTEID test)"
Write-Host "=============================================================="
Write-Host " Expect: CREATED 0 and ALTERED 1 - i.e. it updates, not duplicates."
Write-Host ""

Start-Sleep -Seconds 3
$r2 = Send-Tally $invoiceXml 180
Write-Host $r2

Write-Host ""
Write-Host "=============================================================="
Write-Host " STEP 4 - read the vouchers back"
Write-Host "=============================================================="

$vouchersXml = @'
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>V</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>PRATHAM TEST COMPANY</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20270331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="V" ISINITIALIZE="Yes"><TYPE>Voucher</TYPE><NATIVEMETHOD>VoucherNumber</NATIVEMETHOD><NATIVEMETHOD>Date</NATIVEMETHOD><NATIVEMETHOD>PartyLedgerName</NATIVEMETHOD><NATIVEMETHOD>Amount</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
'@

$r3 = Send-Tally $vouchersXml 120
$vnums = [regex]::Matches($r3, '<VOUCHERNUMBER>([^<]*)</VOUCHERNUMBER>') | ForEach-Object { $_.Groups[1].Value }
Write-Host "  vouchers found: $($vnums.Count)"
foreach ($v in $vnums) { Write-Host "    - $v" }
Write-Host ""
Write-Host "  T/2982/2026-27 should appear EXACTLY ONCE. Twice means REMOTEID failed."
Write-Host ""
Write-Host "=============================================================="
Write-Host " DONE - copy everything above back to Claude"
Write-Host "=============================================================="
