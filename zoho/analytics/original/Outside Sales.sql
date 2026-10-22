SELECT
		 "Meeting Done Date" AS "Meeting Date",
		 "Full Name" AS "Name",
		 "Sales Leads Status" AS "Status",
		 "Plot Location",
		 "Khata",
		 "Budget (Lacs)" AS "Prpsd. Cost",
		 "Project Start Date" AS "Prj.St.Dt.",
		 
			CASE
				 WHEN "Lead Source"  IN ( 'Google AdWords'  , 'Unknown'  , 'Direct Call'  )
				 OR	"Lead Source"  IS NULL THEN 'Google AdWords'
				 ELSE "Lead Source"
			 END AS "Lead Source",
		 "Lead Owner Name" As "Owner",
		 "Created Time",
		 "Comments_leads" AS "Comments",
		 "Lead Converted Date" AS "Cnvtd. Date",
		 "Agreement Signed Date" AS "Agmnt Snd. Dt.",
		 "Client Current Budget" AS "Agmnt Amount",
		 TO_NUMBER(REPLACE("Budget (Lacs)", ',', '')) AS "Proposed Budget",
		 1 As "test"
FROM  "Leads" 
WHERE	 "Meeting Done Date"  IS NOT NULL
ORDER BY "Meeting Done Date" DESC 

