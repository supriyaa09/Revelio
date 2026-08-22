-- ============================================================================
-- seed.sql — institutional taxonomy (departments → categories)
-- Synthetic reference data only. No real personal or institutional data.
-- Safe to re-run.
-- ============================================================================

insert into departments (name, slug, sort_order) values
  ('Academic',       'academic',       1),
  ('Administration', 'administration', 2),
  ('Finance',        'finance',        3),
  ('HR',             'hr',             4),
  ('Procurement',    'procurement',    5)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

-- match_keywords drives automatic classification. Keep terms distinctive:
-- generic words that appear in every document make categories collide.
with d as (select id, slug from departments)
insert into categories (department_id, name, slug, description, match_keywords, sort_order)
select d.id, v.name, v.slug, v.description, v.kw, v.sort_order
from d
join (values
  -- Academic
  ('academic', 'Notices',           'notices',           'Academic notices and announcements',
     array['notice','announcement','circular to students','examination schedule','semester'], 1),
  ('academic', 'Reports',            'reports',           'Academic and departmental reports',
     array['report','annual report','assessment','accreditation','outcome'], 2),
  ('academic', 'Policies',           'policies',          'Academic regulations and policies',
     array['regulation','academic policy','curriculum','syllabus','attendance policy'], 3),

  -- Administration
  ('administration', 'Circulars',    'circulars',         'Administrative circulars',
     array['circular','office order','memorandum','notification'], 1),
  ('administration', 'Requests',     'requests',          'Internal administrative requests',
     array['request','application for','permission','approval request'], 2),
  ('administration', 'Forms',        'forms',             'Administrative forms and templates',
     array['form','template','declaration','undertaking'], 3),

  -- Finance
  ('finance', 'Budgets',             'budgets',           'Budget proposals and allocations',
     array['budget','allocation','fiscal','expenditure','estimate'], 1),
  ('finance', 'Invoices',            'invoices',          'Invoices and payment documents',
     array['invoice','bill','payment','receipt','gst','tax'], 2),
  ('finance', 'Approvals',           'approvals',         'Financial sanctions and approvals',
     array['sanction','financial approval','disbursement','reimbursement'], 3),

  -- HR
  ('hr', 'Recruitment',              'recruitment',       'Recruitment and hiring documents',
     array['recruitment','vacancy','interview','appointment','candidate'], 1),
  ('hr', 'Leave',                    'leave',             'Leave and attendance records',
     array['leave','absence','attendance','casual leave','medical leave'], 2),
  ('hr', 'Policies',                 'hr-policies',       'HR policies and handbooks',
     array['employee handbook','hr policy','code of conduct','grievance','payroll'], 3),

  -- Procurement
  ('procurement', 'Quotations',      'quotations',        'Vendor quotations and bids',
     array['quotation','quote','bid','tender','rate contract'], 1),
  ('procurement', 'Purchase Requests','purchase-requests','Purchase requisitions',
     array['purchase request','requisition','indent','procure'], 2),
  ('procurement', 'Vendor Documents','vendor-documents',  'Vendor registration and contracts',
     array['vendor','supplier','contract','agreement','msme'], 3)
) as v(dept_slug, name, slug, description, kw, sort_order)
  on v.dept_slug = d.slug
on conflict (department_id, slug) do update
  set name           = excluded.name,
      description    = excluded.description,
      match_keywords = excluded.match_keywords,
      sort_order     = excluded.sort_order;
