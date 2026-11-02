"""Print the MIS's tables as JSON on stdout, for Backend/mis-sync.ts.

Read-only: works on a temporary copy of the workbook, deletes it, and writes
nothing else to disk. The output holds customer data, so it goes to a pipe and is
never saved. Reading the stored cell values avoids the UTC shift that writing or
reading dates through Excel COM can cause (MIS notes, 14 Oct 2026).
"""
import datetime
import json
import os
import shutil
import sys
import tempfile
import warnings

import openpyxl

warnings.filterwarnings("ignore")

CUSTOMER = {
    "caseId": "Case ID", "leadDate": "Lead Received Date", "name": "Customer Name", "mobile": "Mobile Number",
    "place": "City / Location", "leadSource": "Lead Source", "loanType": "Loan Type",
    "otherLoanDescription": "Other Loan Type Description", "employmentType": "Employment / Business Type",
    "amount": "Loan Amount Requested", "assignedId": "Assigned Telecaller ID", "originalId": "Original Telecaller ID",
    "documentStatus": "Overall Document Status", "caseStatus": "Overall Case Status", "notes": "Case Notes",
    "closureDate": "Closure Date", "closureReason": "Closure Reason", "location": "Record Location",
    "createdAt": "Created Timestamp",
}
APPLICATION = {
    "applicationId": "Application ID", "caseId": "Case ID", "lender": "Bank / NBFC", "loginDate": "Login Date",
    "reference": "Application Reference Number", "loginEmployeeId": "Login Team Employee ID", "status": "Lender Status",
    "amountApproved": "Amount Approved", "sanctionAmount": "Sanction Amount", "sanctionDate": "Sanction Date",
    "acceptanceStatus": "Sanction Acceptance Status", "acceptanceDate": "Sanction Acceptance Date",
    "disbursementAmount": "Disbursement Amount", "disbursementDate": "Disbursement Date",
    "rejectionReason": "Rejection Reason", "notes": "Application Notes", "banker": "Banker Name",
    "createdAt": "Created Timestamp",
}
FOLLOWUP = {
    "followupId": "Follow-up ID", "caseId": "Case ID", "applicationId": "Application ID",
    "activityAt": "Activity Date and Time", "activityType": "Activity Type", "notes": "Activity Notes",
    "nextAction": "Next Action", "dueDate": "Due Date", "responsibleId": "Responsible Employee ID",
    "status": "Activity Status", "completionDate": "Completion Date",
}
CHANGE = {"recordId": "Record ID", "field": "Field", "newValue": "New Value", "at": "Timestamp"}
EMPLOYEE = {"id": "Employee ID", "name": "Employee Name"}


def clean(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()[:19]
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def read(wb, sheet, columns, key):
    ws = wb[sheet]
    rows = list(ws[list(ws.tables.values())[0].ref])
    head = [cell.value for cell in rows[0]]
    at = {field: head.index(title) for field, title in columns.items()}
    out = []
    for row in rows[1:]:
        record = {field: clean(row[i].value) for field, i in at.items()}
        if record[key]:
            out.append(record)
    return out


def main():
    source = sys.argv[1]
    folder = tempfile.mkdtemp()
    try:
        copy = os.path.join(folder, "mis.xlsm")
        shutil.copy2(source, copy)
        wb = openpyxl.load_workbook(copy, data_only=True)
        data = {
            "customers": read(wb, "Customers", CUSTOMER, "caseId"),
            "applications": read(wb, "Lender Applications", APPLICATION, "applicationId"),
            "followups": read(wb, "Follow-up Log", FOLLOWUP, "followupId"),
            "changes": read(wb, "Change Log", CHANGE, "recordId"),
            "employees": read(wb, "Employees", EMPLOYEE, "id"),
        }
        for customer in data["customers"]:
            if customer["mobile"] is not None:
                customer["mobile"] = str(customer["mobile"])
        for change in data["changes"]:
            if change["newValue"] is not None:
                change["newValue"] = str(change["newValue"])
        wb.close()
        json.dump(data, sys.stdout)
    finally:
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    main()
