import { CONTRIBUTOR_LOGOS } from "@/lib/contributor-logos";

type ContributorQuote = {
  text: string;
  attribution: string;
  logo: (typeof CONTRIBUTOR_LOGOS)[keyof typeof CONTRIBUTOR_LOGOS] | null;
  post?: {
    title: string;
    href: string;
  };
};

// Publish only quotes approved in the source document or correspondence, or explicitly supplied for publication.
// https://docs.google.com/document/d/10bnpSssurB9mtlQ61Qe6rcBH44dUdFWhjXS6F8HrHSs
export const CONTRIBUTOR_QUOTES: readonly ContributorQuote[] = [
  {
    text:
      "Agents built by small businesses and individuals will soon outnumber enterprise agents, and most of them will never own a discovery endpoint. A combination of AI Catalog, ARD, and the thin resolution layer of NandaIndex will allow every agent to be found.",
    attribution: "Sam Sharaf and Junjie Bu, Google",
    logo: null,
  },
  {
    text:
      "The agentic web won’t run on one directory. It will be many independently operated registries and platforms, and agents have to be discoverable across all of them. AGNTCY’s Agent Directory and NandaIndex solve complementary halves of that problem, and doing it on open standards is how it scales.",
    attribution: "Vijoy Pandey, SVP/GM, Outshift by Cisco",
    logo: CONTRIBUTOR_LOGOS["Cisco"],
  },
  {
    text:
      "From net neutrality to expanding broadband access, I have long believed that the internet works best when it is open, accessible, and trusted. MIT helped build the foundations of the World Wide Web in the 1990s. The research at MIT Media Lab along with many of our member companies over the last few years are now creating a DNS-like system for agent discovery and verifiable identity that can help make the emerging internet of AI agents open, inclusive, and safe.",
    attribution: "Jessica Rosenworcel, Executive Director, MIT Media Lab",
    logo: CONTRIBUTOR_LOGOS["MIT Media Lab"],
  },
  {
    text:
      "The emerging Internet of AI Agents raises important questions about discovery, identity, interoperability, and accountability. I would like to see the community develop a shared understanding of the desirable properties of this infrastructure. The NandaIndex initiative offers a useful forum for exploring these questions and developing open, interoperable approaches.",
    attribution: "Vint Cerf, Internet Pioneer and Co-Designer of TCP/IP",
    logo: null,
  },
  {
    text:
      "In just the last few months, we have seen AI agents acting on behalf of consumers and businesses dramatically rise. For an open agentic economy to scale, agents must be able to discover relevant services across fragmented ecosystems. An open discovery effort like NandaIndex is an important step in that direction, and we welcome the industry conversation on how verified identity, trust, and secure commerce can be built on top of them.",
    attribution: "Arjun Chittoor, VP, PayPal",
    logo: CONTRIBUTOR_LOGOS["PayPal"],
  },
  {
    text:
      "The Internet of AI Agents will require the same fundamental qualities that made the internet successful: open interoperability, distributed infrastructure, and resilient communication across independent networks. Akamai has been exploring federated agent discovery, dynamic resolution, and real-world multi-agent deployment. NandaIndex represents a solid proposal toward connecting these independent agent ecosystems, while distributed cloud infrastructure provides the foundation to run them securely and at scale.",
    attribution: "Hema Seshadri, Ph.D., Principal Consulting AI & Data Engineer, Akamai Technologies & Adjunct Analytics Professor, Northeastern University",
    logo: CONTRIBUTOR_LOGOS["Akamai Cloud"],
  },
  {
    text:
      "Widespread adoption of AI agents – particularly as they become embedded in new devices and interfaces – will generate additional network traffic and create new connectivity demands. Mobile operators are working to address these challenges and will need interoperable, open solutions that can scale across networks. Just as importantly, trust and security must be built in from the outset, including reliable ways to verify an agent’s identity and permissions, safeguard personal data and protect consumers from fraud or misuse.",
    attribution: "Louis Powell, Director of AI Initiatives, GSMA",
    logo: CONTRIBUTOR_LOGOS["GSMA"],
    post: {
      title: "GSMA: Connecting the Mobile World to the Open Agentic Web",
      href: "https://lnkd.in/p/gAz42Dzm",
    },
  },
  {
    text:
      "In mission-critical environments, AI must do more than demonstrate intelligence—it must be reliable, accountable, and designed to support human decision-making. At Motorola Solutions, we're bringing AI into communications, video security, and command center workflows where these principles matter most. As intelligent systems become increasingly agentic, open initiatives like NandaIndex can help establish the discovery infrastructure needed for independently developed agents to find one another, while preserving the security, control, and trust these environments demand.",
    attribution: "Dr. Mahesh Saptharishi, Executive Vice President and CTO, Motorola Solutions",
    logo: null,
  },
  {
    text:
      "The future of the connected home isn't about adding more apps or devices—it's about making technology work together effortlessly for people. At TELUS, we're building intelligent, connected experiences that bring together entertainment, smart home devices, and digital services. As personal AI agents become the interface to these experiences, open initiatives like NandaIndex can help agents discover and interact across independent platforms, making connected living simpler, more useful, and more accessible.",
    attribution: "Amit Nag, Vice President, Connected Products & Experiences, TELUS",
    logo: null,
  },
  {
    text:
      "The Neuro SAN framework at Cognizant enables networks of specialized AI agents to collaborate and solve complex enterprise problems. NandaIndex complements this vision by providing an open discovery and resolution layer, allowing agents built on different frameworks and platforms to find and collaborate with one another across organizational boundaries.",
    attribution: "Babak Hodjat, CTO, Cognizant",
    logo: CONTRIBUTOR_LOGOS["Cognizant"],
    post: {
      title: "The Agentic Web Needs Both a Phone Book and Builder Tools",
      href: "https://www.cognizant.com/us/en/ai-lab/blog/building-agentic-web-nandaindex-neuro-san",
    },
  },
  {
    text:
      "At Nutanix, we see enterprise AI evolving toward distributed agents operating across private clouds, public clouds, and edge environments. NandaIndex offers an open approach to agent discovery that enables interoperability independent of the underlying infrastructure.",
    attribution: "Debo Dutta, Head of AI, Nutanix",
    logo: CONTRIBUTOR_LOGOS["Nutanix"],
  },
  {
    text:
      "At Kyndryl, we have worked with MIT's NANDA ecosystem for 18 months. Our customers run mission-critical systems, so governance and trust come first. NandaIndex is an important step toward an open, interoperable, trusted agentic web, one that lets enterprises bring in public agents without exposing private agents or data.",
    attribution: "Ilyas Iyoob, Global Head of Research, Kyndryl",
    logo: CONTRIBUTOR_LOGOS["Kyndryl"],
  },
  {
    text:
      "Merchants of every size should be able to participate in agentic commerce while keeping control of their data, customer relationships, and technology choices. Open, interoperable standards, and approaches like NandaIndex that make small-business agents easier to find across platforms, can lower the barrier for merchants to reach customers through any AI agent. It’s why any BigCommerce store with an active storefront can let AI agents search its catalog, build a cart, and hand off to the merchant’s own checkout through MCP.",
    attribution: "Anil Kamath, Board Member, BigCommerce",
    logo: CONTRIBUTOR_LOGOS["Commerce"],
  },
  {
    text:
      "At Hello Haven, we believe personal AI agents should operate in an open ecosystem, not in the walled gardens that characterized the early internet, such as AOL. We are committed to making all Hello Haven agents discoverable through NandaIndex by default, enabling them to connect and collaborate with other personal, business, and enterprise agents across the open agentic web.",
    attribution: "Frank Addante, Founder & Chief Human, Hello Haven",
    logo: CONTRIBUTOR_LOGOS["Hello Haven"],
  },
  {
    text:
      "AI agents need a verifiable identity to earn trust, and they need to be as easy to discover as a domain name, without their owners having to manage complex infrastructure. That's why Inkbox supports NandaIndex: anyone can register their agent and make it discoverable across the open agentic web.",
    attribution: "Ray Liao, Founder and CEO, Inkbox",
    logo: CONTRIBUTOR_LOGOS["Inkbox"],
  },
  {
    text:
      "From launching the first MCP servers integrated with NandaIndex in April 2025 to supporting MIT courses and students working on the earliest versions of the NANDA platform, ME-US has been part of this journey from the beginning. We believe NandaIndex can play a foundational role in enabling an open agentic web where businesses, developers, and individuals can connect and collaborate across platforms.",
    attribution: "Zafer Sahinoglu, VP of Innovation, Mitsubishi Electric",
    logo: CONTRIBUTOR_LOGOS["Mitsubishi Electric"],
  },
  {
    text:
      "Nasiko has been a core contributor to NANDA, helping build the open infrastructure needed for AI agents to operate and collaborate across organizational boundaries. We believe the open agentic web must be supported by strong governance, secure agent runtimes, and verifiable identities, and NandaIndex is an important foundation for enabling agents to be discoverable, accountable, and trusted at scale.",
    attribution: "Rahul Todkar, CEO and co-founder, Nasiko",
    logo: CONTRIBUTOR_LOGOS["Nasiko"],
  },
  {
    text:
      "At Tata Consultancy Services (TCS), we believe the future of enterprise AI depends on agents collaborating seamlessly across organizations, industries, and platforms. NandaIndex provides an open foundation for agent discovery and interoperability, enabling enterprises to participate in a connected and trusted agentic web.",
    attribution: "Harrick Vin, CTO, TCS",
    logo: CONTRIBUTOR_LOGOS["Tata Consultancy Services"],
  },
  {
    text:
      "At HCLTech, we see Agentic AI becoming integral to how enterprises operate, collaborate, and serve customers. As organizations deploy agents across different clouds, platforms, and business ecosystems, open discovery and interoperability will be essential. NandaIndex offers a promising approach to connecting these agents across organizational boundaries while preserving enterprise control, security, and governance.",
    attribution: "Vijay Guntur, CTO, HCLTech",
    logo: CONTRIBUTOR_LOGOS["HCLTech"],
  },
  {
    text:
      "For the agentic economy to scale, AI agents need cross-platform interoperability. At Hexaware, our collaboration with the open-source Project NANDA reflects that commitment — and NandaIndex is a practical step toward making AI agents accessible, safe, and useful across industries, organizations, and communities.",
    attribution: "Erik Haug, Global Head of AI Partnerships, Hexaware Technologies",
    logo: CONTRIBUTOR_LOGOS["Hexaware"],
  },
  {
    text:
      "By our research, 99 percent of the web isn't ready for AI agents, and most agents fail before they ever reach the business they're looking for. Discovery is where the agentic web breaks first. We need to reinvent it for agents, not retrofit search-era methods. NandaIndex takes a bold step in that direction, making businesses and individuals discoverable by any agent, without requiring their own infrastructure. It complements open standards like ARD and MCP Apps that we're helping build, and we're excited to work with the NANDA team to bring this vision to life.",
    attribution: "Liad Yosef, Co-founder & CTO, Ora",
    logo: CONTRIBUTOR_LOGOS["Ora"],
    post: {
      title: "Ora Partners with MIT's NandaIndex to Build the Open Agentic Web",
      href: "https://ora.ai/blog/ora-partners-with-mit-nandaindex-to-build-the-open-agentic-web",
    },
  },
  {
    text:
      "Having contributed to the evolution of the internet from IP-based mobile networks to 5G and beyond, I see the emergence of AI agents as another important step in how networks connect people, businesses, and intelligent systems. At Ericsson, we have been working with MIT and NANDA to advance this vision, and NandaIndex provides a promising foundation for open agent discovery, interoperability, and trusted coordination across the emerging agentic web.",
    attribution: "Mallik Tatipamula, CTO, Ericsson Silicon Valley",
    logo: CONTRIBUTOR_LOGOS["Ericsson"],
  },
  {
    text:
      "Finding an AI agent and trusting it are two different problems, and the agentic web needs both solved. WorkOS is building the identity and authorization layer for agents, while NandaIndex provides an open approach to discovery across platforms and organizations.",
    attribution: "Michael Grinich, Founder & CEO, WorkOS",
    logo: CONTRIBUTOR_LOGOS["WorkOS"],
  },
  {
    text:
      "The internet succeeded because no single company had to own it for everyone to participate. We are working to bring that same openness to the Internet of AI Agents. NandaIndex provides a foundation for agents to find one another across platforms and organizations, so that individuals, startups, and enterprises can all participate in the agentic economy on equal terms.",
    attribution: "Sharath Chandra and Chris Pease, ProjectNanda",
    logo: CONTRIBUTOR_LOGOS["Project NANDA"],
  },
  {
    text:
      "Agentic commerce will transform how consumers and businesses discover products, negotiate services, and transact through AI agents. For this new economy to scale, buyers’ and sellers’ agents must be able to find and engage with one another across platforms. NandaIndex provides an important building block for enabling open, interoperable agent-to-agent commerce.",
    attribution: "Sandhya Arun, Chief Technology Officer, Wipro Limited",
    logo: CONTRIBUTOR_LOGOS["Wipro"],
  },
  {
    text:
      "We're moving toward a world with billions of autonomous AI agents, each needing its own identity, infrastructure, and place in the digital world. Maritime makes it possible to run these agents at scale, while NandaIndex makes them discoverable and reachable. Together, we're building the foundation for an open agentic web.",
    attribution: "Maria Gorskikh, Founder & CEO, Maritime (YC F26)",
    logo: CONTRIBUTOR_LOGOS["Maritime"],
    post: {
      title: "Every agent needs a home and an address",
      href: "https://maritime.sh/blog/nandaindex-every-agent-needs-a-home-and-an-address",
    },
  },
  {
    text:
      "We are entering an era in which AI is becoming a new form of productive labor, fundamentally transforming how companies, institutions, and entire economies operate. At Wand AI, we are defining and building this future through autonomous AI workers, a unified operating system for human and artificial intelligence, and the infrastructure required to integrate AI labor into national economies. As billions of AI agents emerge across organizations and countries, open discovery and interoperability become essential. Initiatives such as NandaIndex represent an important step toward connecting these independently governed AI workforces and enabling a truly global agentic economy.",
    attribution: "Rotem Alaluf, Founder & CEO, Wand AI",
    logo: CONTRIBUTOR_LOGOS["Wand AI"],
    post: {
      title: "Wand AI: An Open Agentic Web Needs Open Discovery",
      href: "https://lnkd.in/p/gsX4NqKp",
    },
  },
  {
    text:
      "Healthcare has spent decades paying for systems that can’t talk to each other, and AI agents can’t repeat that mistake. As clinicians start working alongside agents for documentation, coding, and care coordination, those agents need to find and trust one another across health systems, EHRs, and vendors. At Suki, we’ve always focused on building infrastructure rather than point solutions, and Nanda Index brings that same open, interoperable approach to how agents are discovered.",
    attribution: "Punit Soni, CEO and Co-Founder of Suki",
    logo: CONTRIBUTOR_LOGOS["Suki"],
  },
  {
    text:
      "At TinyFish we run enterprise-grade agents on the open web every day, and the hardest part is rarely the task itself. It’s knowing where to go and whether to trust what’s there. Most businesses will never publish an API or build their own agent. An open index that makes them findable anyway is the right foundation for an agentic web that includes everyone, not just the companies that can afford to rebuild for it.",
    attribution: "Sudheesh Nair, Co-founder & CEO, TinyFish",
    logo: CONTRIBUTOR_LOGOS["TinyFish"],
  },
  {
    text:
      "At AGI House, we've seen firsthand through our Internet of Agents and Agent Identity Build Days that the next wave of AI innovation requires more than increasingly powerful models. Agents need ways to discover one another, establish trust, and work together across independent platforms. NandaIndex is a promising initiative to help build that open foundation, giving the next generation of AI founders and developers the infrastructure to create products that no single platform could enable alone.",
    attribution: "Rocky Yu, Founder, AGI House & General Partner, AGI House Ventures",
    logo: CONTRIBUTOR_LOGOS["AGI House"],
  },
  {
    text:
      "Industrial AI agents cannot operate in silos. At L&T Technology Services (LTTS), our Engineering Intelligence and AgenticIQ initiatives are bringing autonomous agents into complex engineering and manufacturing workflows. NandaIndex can help extend this collaboration across enterprise boundaries through open, federated discovery, without compromising control over proprietary engineering systems and data.",
    attribution: "Piyush Jain, Deputy CTO, L&T Technology Services (LTTS)",
    logo: CONTRIBUTOR_LOGOS["L&T Technology Services"],
  },
  {
    text:
      "At Nebius, we believe the next generation of AI infrastructure must make it easy to move from powerful models to reliable, production-ready AI agents. Our work on Nebius AI Cloud, Token Factory, and AI-powered infrastructure management is helping developers make that transition. But a truly open agentic ecosystem also needs ways for agents running on different clouds and platforms to discover one another. NandaIndex is an important initiative toward making that interoperability possible.",
    attribution: "Narek Tatevosyan, VP of Product, Nebius",
    logo: CONTRIBUTOR_LOGOS["Nebius"],
  },
];

