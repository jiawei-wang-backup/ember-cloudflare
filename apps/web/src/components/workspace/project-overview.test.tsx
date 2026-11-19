import {act,render,screen,waitFor,fireEvent} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {ProjectOverview} from "./project-overview";
afterEach(()=>vi.unstubAllGlobals());
it("never inserts a temporary header while checking an unbound room",async()=>{
  let answer!:(value:Response)=>void;
  vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{answer=resolve;})));
  const {container}=render(<ProjectOverview roomId="unbound"/>);
  expect(container).toBeEmptyDOMElement();
  await act(async()=>answer(new Response(null,{status:404})));
  expect(container).toBeEmptyDOMElement();
});
it("does not add a project panel to an unbound room",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})));
  render(<ProjectOverview roomId="room-a"/>);
  await waitFor(()=>expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
it("shows a permission error without displaying project data",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:403})));
  render(<ProjectOverview roomId="room-b"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("没有此项目的数据权限");
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
it("collapses all statistics by default, and keeps cached input separate when expanded",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(Response.json({project:{full_name:"example/scoped",status:"unknown",owner:null},usage:{input_tokens:"100",cached_input_tokens:"90",output_tokens:"5",updated_at:null},window:{days:7},milestone_progress:null,milestones:[],pulls:[],members:[],models:[],activities:[],fetched_at:"2026-11-16T00:00:00Z",cost:{label:"费用未知"},quota:{reason:"账号额度未授权"}}))));
  render(<ProjectOverview roomId="room-c"/>);
  const panel=await screen.findByRole("region",{name:"Project Pulse 项目概览"});
  expect(screen.getByText("Input Tokens")).not.toBeVisible();
  const toggle=screen.getByRole("button",{name:/展开项目统计/});
  expect(toggle).toHaveAttribute("aria-expanded","false");
  fireEvent.click(toggle);
  expect(screen.getByText("Input Tokens")).toBeVisible();
  expect(panel).toHaveTextContent("100");expect(panel).toHaveTextContent("90");expect(panel).not.toHaveTextContent("190");
  expect(screen.getByRole("tab",{name:/成员与活动/})).toBeInTheDocument();
  expect(panel).toHaveTextContent("暂无里程碑");
  fireEvent.change(screen.getByRole("combobox",{name:"项目统计时间窗"}),{target:{value:"30"}});
  await waitFor(()=>expect(fetch).toHaveBeenLastCalledWith("/api/rooms/room-c/project?days=30",expect.anything()));
  expect(screen.getByRole("button",{name:/收起项目统计/})).toHaveAttribute("aria-expanded","true");
  fireEvent.click(screen.getByRole("button",{name:/收起项目统计/}));
  expect(screen.getByText("Input Tokens")).not.toBeVisible();
});
it("shows reports as recorded completion and preserves repository identity for equal PR numbers",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({project:{full_name:"example/scoped",status:"unknown",owner:null},usage:{input_tokens:null,cached_input_tokens:null,output_tokens:null,updated_at:null},window:{days:7,kind:"calendar-utc8"},milestone_progress:{completed:1,accepted:0,total:2,basis:"reported"},milestones:[{title:"登录",state:"completed",due_on:null,evidence:"源证据"}],pulls:[{number:"1",title:"登录修复",url:"https://github.com/example/one/pull/1",state:"open",repository_full_name:"example/one",is_draft:true},{number:"1",title:"入口修复",url:"https://github.com/example/two/pull/1",state:"merged",repository_full_name:"example/two"}],members:[],models:[],activities:[],fetched_at:"2026-11-16",source:"LAN",cost:{label:"费用未知"},quota:{reason:"未知"},caveats:[]})));
  render(<ProjectOverview roomId="reports"/>);
  fireEvent.click(await screen.findByRole("button",{name:/展开项目统计/}));
  expect(screen.getByText("阶段记录完成")).toBeVisible();
  expect(screen.getByTitle("1/2")).toBeVisible();
  expect(screen.getByText(/阶段记录完成不等于业务验收/)).toBeVisible();
  fireEvent.mouseDown(screen.getByRole("tab",{name:/产出文档/}),{button:0,ctrlKey:false});
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByText(/example\/two/)).toBeVisible();
  expect(screen.getByText(/草稿/)).toBeVisible();
});
it("shows all participants as owners and separates evidence, documents and source details",async()=>{
  const member=(name:string)=>({developer_id:null,display_name:name,role:"采集参与者",last_activity_at:"2026-11-16",sessions:1,usage:null});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({project:{full_name:"example/scoped",status:"on_track",owner:{display_name:"成员甲 · abcdef012345、成员乙"},owner_basis:"participants"},usage:{input_tokens:"100",cached_input_tokens:null,output_tokens:"5",updated_at:null},window:{days:7},milestone_progress:null,milestones:[],pulls:[],members:[member("成员甲 · abcdef012345"),member("成员乙")],models:[],activities:[],fetched_at:"2026-11-16",source:"LAN",cost:{label:"费用未知"},quota:{reason:"未知"},caveats:[]})));
  render(<ProjectOverview roomId="owners"/>);
  const expand=await screen.findByRole("button",{name:"展开项目统计"});
  expect(screen.getByTitle("负责人：成员甲 · abcdef012345、成员乙")).toBeVisible();
  fireEvent.click(expand);
  expect(screen.getByText("负责人",{exact:true})).toBeVisible();
  expect(screen.getByRole("tab",{name:/阶段证据/})).toHaveAttribute("aria-selected","true");
  fireEvent.mouseDown(screen.getByRole("tab",{name:/成员与活动/}),{button:0,ctrlKey:false});
  expect(screen.getByText("负责人按参与成员展示。")).toBeVisible();
  expect(screen.getByTitle("成员甲 · abcdef012345")).toHaveTextContent("成员甲");
  fireEvent.mouseDown(screen.getByRole("tab",{name:"统计口径"}),{button:0,ctrlKey:false});
  expect(screen.getByText("来源：LAN")).toBeVisible();
});

it("refreshes reported progress when the project tab becomes visible", async () => {
  const snapshot = {
    project: {full_name: "example/scoped", status: "on_track", owner: null},
    usage: {input_tokens: null, output_tokens: null},
    milestone_progress: {completed: 1, accepted: 0, total: 2, basis: "reported"},
    milestones: [], members: [], pulls: [], models: [], activities: [],
    window: {days: 7}, cost: {label: "费用未知"}, quota: {reason: "未知"},
  };
  const fetchProject = vi.fn()
    .mockResolvedValueOnce(Response.json(snapshot))
    .mockResolvedValueOnce(Response.json({...snapshot, milestone_progress: {...snapshot.milestone_progress, completed: 2}}));
  vi.stubGlobal("fetch", fetchProject);
  render(<ProjectOverview roomId="room-refresh"/>);
  fireEvent.click(await screen.findByRole("button", {name: /展开项目统计/}));
  expect(screen.getByTitle("1/2")).toBeVisible();
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(screen.getByTitle("2/2")).toBeVisible());
});
