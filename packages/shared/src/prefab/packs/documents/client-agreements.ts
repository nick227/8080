import type { PrefabDocument, PrefabPack } from '../../schemas'

export const clientAgreementsPack: PrefabPack<PrefabDocument> = {
  id: 'pack.documents.client-agreements',
  domain: 'documents',
  name: 'Client Commercial Agreements',
  description: 'Production-ready legal contracts and statement of work drafts for client services.',
  records: [
    {
      key: 'doc:msa-template',
      packId: 'pack.documents.client-agreements',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      title: 'Master Services Agreement (MSA)',
      kind: 'agreement',
      summary: 'Governing master agreement covering confidentiality, IP transfer upon payment, warranty, liability caps, and Net-15 terms.',
      requiresReview: true,
      content: `# MASTER SERVICES AGREEMENT (MSA)
*NOTICE: This document is a standardized operational draft. Review with qualified legal counsel before client execution.*

## 1. Engagement & Statements of Work
This Master Services Agreement ("Agreement") governs all professional services, advisory deliverables, and work products provided by the Service Provider to the Client as described in one or more executed Statements of Work ("SOW").

## 2. Fees, Invoicing & Payment Terms
- **Invoicing Cadence**: Invoices are issued upon milestone completion or on the 1st and 15th of each calendar month.
- **Payment Terms**: All invoices are due Net 15 days from date of transmission.
- **Late Interest**: Undisputed balances outstanding beyond 30 days accrue interest at 1.5% per month or the legal maximum.

## 3. Intellectual Property Rights & Ownership
- **Client Ownership**: Conditioned upon receipt of full payment for all related fees, Service Provider assigns all right, title, and interest in customized deliverables to the Client.
- **Pre-Existing IP & Tools**: Service Provider retains full ownership of general architectural libraries, internal scripts, and tooling developed prior to or independently of this engagement.

## 4. Confidentiality & Non-Disclosure
Both parties agree to protect proprietary information, technical architecture, and commercial figures with the same degree of care used to protect their own trade secrets (not less than reasonable care).

## 5. Warranties & Limitation of Liability
Service Provider warrants that work will be performed in a professional and workmanlike manner. Except for willful misconduct, neither party shall be liable for indirect, incidental, or consequential damages. Maximum liability is capped at total fees paid under the applicable SOW.
`,
    },
    {
      key: 'doc:sow-template',
      packId: 'pack.documents.client-agreements',
      version: 1,
      source: {
        provenance: 'synthetic-editorial',
        verifiedAt: '2026-10-11',
      },
      title: 'Statement of Work (SOW) — Milestone Delivery',
      kind: 'agreement',
      summary: 'Standard fixed-fee or milestone sprint agreement establishing deliverables, review periods, and change order bounds.',
      requiresReview: true,
      content: `# STATEMENT OF WORK: MILESTONE DELIVERY
*Governed by the terms of the Master Services Agreement (MSA).*

## 1. Project Overview & Objectives
- **Client Name**: [Client Organization]
- **Project Title**: [Engagement Name]
- **Target Launch Date**: [Target Date]

## 2. Deliverable Milestones
| Milestone | Scope Description | Deliverable Acceptance Artifact | Est. Timeline | Fixed Fee |
| :--- | :--- | :--- | :--- | :--- |
| **M1: Discovery** | Technical requirements, architecture review, user journeys | Architecture Blueprint & Sprint Backlog | Week 1–2 | $6,000 |
| **M2: Core Sprint** | Component implementation, staging deployment, API integrations | Staging Demo & Automated Test Suite | Week 3–6 | $14,000 |
| **M3: Release QA** | Performance tuning, security review, production cutover | Production Sign-off & Handover Bundle | Week 7–8 | $8,000 |

## 3. Client Acceptance Criteria
Client shall have five (5) business days following deliverable submission to review and either provide written acceptance or detailed deficiency notices. Failure to respond within 5 business days constitutes formal acceptance.

## 4. Change Control & Out-of-Scope Work
Any request altering the timeline, scope, or deliverables requires a written Change Order specifying adjusted fees and delivery dates prior to execution.
`,
    },
  ],
}
