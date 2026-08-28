export type EmailSequenceStep = {
  order: number;
  label: string;
  delayDays: number;
  subjectTemplate: string;
  bodyTemplate: string;
};

export type EmailIndustryTemplate = {
  id: string;
  groupName: string;
  description: string;
  keywords: string[];
  steps: EmailSequenceStep[];
};

const step = (
  order: number,
  label: string,
  delayDays: number,
  subjectTemplate: string,
  bodyTemplate: string,
): EmailSequenceStep => ({ order, label, delayDays, subjectTemplate, bodyTemplate });

export const INDUSTRY_EMAIL_TEMPLATES: EmailIndustryTemplate[] = [
  {
    id: "electronics-semiconductor",
    groupName: "Electronics/Semiconductor",
    description: "Chất lượng điện, nhiệt bất thường, khí nén và độ ổn định thiết bị sản xuất.",
    keywords: ["dien tu", "electronics", "semiconductor", "ban dan", "ems", "smt", "pcb", "ict", "thiet bi mang"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp kiểm tra điện và bảo trì thiết bị tại {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Trong các nhà máy điện tử và bán dẫn, chất lượng nguồn điện, nhiệt bất thường tại tủ điện, rò rỉ khí nén và độ ổn định thiết bị có thể ảnh hưởng trực tiếp đến downtime và chất lượng sản phẩm.

Loriot cung cấp các giải pháp Fluke phục vụ kiểm tra điện, phân tích chất lượng điện, camera nhiệt, phát hiện rò rỉ khí và bảo trì dự báo.

Anh/Chị có thể giúp tôi kết nối với bộ phận kỹ thuật hoặc bảo trì phù hợp tại {{companyName}} được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp kiểm tra điện và bảo trì thiết bị tại {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi xin phép follow-up email đã gửi về giải pháp Fluke cho {{companyName}}.

Một số ứng dụng thường được quan tâm gồm kiểm tra chất lượng nguồn, phát hiện điểm phát nhiệt, kiểm tra cách điện và motor, phát hiện rò rỉ khí nén mà không cần dừng dây chuyền, cùng theo dõi tình trạng thiết bị để hạn chế downtime.

Nếu Anh/Chị chia sẻ vấn đề đang ưu tiên, tôi có thể đề xuất nhóm thiết bị phù hợp thay vì gửi danh mục sản phẩm chung.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất ứng dụng Fluke cho {{plantSite}}", `Kính gửi Anh/Chị,

Dựa trên đặc thù hoạt động của {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Loriot có thể hỗ trợ lựa chọn thiết bị theo đúng ứng dụng, tư vấn cấu hình và cung cấp tài liệu kỹ thuật liên quan.

Nếu thuận tiện, tôi mong muốn có một cuộc trao đổi ngắn khoảng 10–15 phút để xác định nhu cầu kiểm tra điện hoặc bảo trì tại nhà máy.`),
      step(4, "Xác nhận cuối", 7, "Xin phép xác nhận nhu cầu tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép gửi lời nhắc cuối liên quan đến giải pháp thiết bị đo Fluke cho {{companyName}}.

Nếu hiện tại công ty chưa có nhu cầu, tôi xin phép lưu lại thông tin và liên hệ vào thời điểm phù hợp hơn. Nếu có kế hoạch kiểm tra điện, bảo trì thiết bị hoặc đầu tư dụng cụ đo, tôi sẵn sàng hỗ trợ tư vấn và báo giá.

Anh/Chị có thể phản hồi nhu cầu hiện tại, thời điểm nên liên hệ lại hoặc người phụ trách phù hợp. Cảm ơn Anh/Chị đã dành thời gian.`),
    ],
  },
  {
    id: "automotive",
    groupName: "Automotive",
    description: "Motor/VFD, pin EV, trạm sạc, cách điện, nhiệt và khí nén trên dây chuyền.",
    keywords: ["o to", "automotive", "xe may", "ev", "pin ev", "battery", "tram sac", "ha tang sac", "charging"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp Fluke cho bảo trì dây chuyền tại {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Đối với nhà máy ô tô và linh kiện, việc kiểm soát motor, biến tần, hệ thống điện, khí nén, nhiệt độ và cách điện có vai trò quan trọng trong việc hạn chế dừng dây chuyền.

Loriot cung cấp các giải pháp Fluke phục vụ bảo trì điện–cơ, kiểm tra nhiệt, phân tích chất lượng điện, phát hiện rò rỉ khí và kiểm tra hệ thống EV.

Anh/Chị có thể giúp tôi kết nối với bộ phận bảo trì hoặc kỹ thuật nhà máy được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp Fluke cho bảo trì dây chuyền tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up nội dung đã gửi tới {{companyName}}.

Các ứng dụng Fluke có thể hỗ trợ gồm kiểm tra motor và biến tần, phát hiện điểm nóng tại tủ điện, kiểm tra cách điện, phát hiện rò rỉ khí nén, kiểm tra pin EV và trạm sạc, cùng theo dõi rung động và tình trạng máy móc.

Anh/Chị đang ưu tiên vấn đề nào trong các nội dung trên? Tôi sẽ gửi đúng giải pháp và tài liệu liên quan.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất thiết bị kiểm tra cho {{plantSite}}", `Kính gửi Anh/Chị,

Với nhu cầu bảo trì dây chuyền và hệ thống điện tại {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Loriot có thể hỗ trợ lựa chọn cấu hình theo từng ứng dụng như motor/VFD, tủ điện, hệ thống khí nén, pin EV hoặc trạm sạc.

Nếu Anh/Chị cung cấp thêm thông tin về thiết bị đang sử dụng hoặc bài toán cần kiểm tra, tôi sẽ chuẩn bị đề xuất kỹ thuật và báo giá phù hợp.`),
      step(4, "Xác nhận cuối", 7, "Xin phép khép lại trao đổi với {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up lần cuối về giải pháp Fluke cho hoạt động bảo trì tại {{companyName}}.

Nếu hiện tại chưa có kế hoạch đầu tư, tôi xin phép liên hệ lại vào thời điểm phù hợp hơn. Khi công ty phát sinh nhu cầu kiểm tra điện, motor, biến tần, khí nén, camera nhiệt hoặc hệ thống EV, Loriot sẵn sàng hỗ trợ.

Nếu Anh/Chị không phải người phụ trách, rất mong Anh/Chị chuyển giúp thông tin tới bộ phận kỹ thuật hoặc bảo trì phù hợp.`),
    ],
  },
  {
    id: "steel-cement",
    groupName: "Steel/Cement",
    description: "Motor công suất lớn, lò nung, thiết bị quay, chất lượng điện và môi trường khắc nghiệt.",
    keywords: ["thep", "kim loai", "luyen kim", "gang", "cement", "xi mang", "vlxd", "vat lieu xay dung", "khai khoang", "gach"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp bảo trì điện–cơ Fluke cho {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Trong nhà máy thép và xi măng, motor công suất lớn, lò nung, hệ thống điện, quạt, băng tải và khí nén thường phải làm việc trong điều kiện tải cao và môi trường khắc nghiệt.

Loriot cung cấp các giải pháp Fluke phục vụ kiểm tra điện, camera nhiệt, đo rung, căn chỉnh trục, phân tích chất lượng điện và phát hiện rò rỉ khí.

Anh/Chị có thể giúp tôi kết nối với bộ phận bảo trì điện–cơ hoặc reliability được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp bảo trì điện–cơ Fluke cho {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up email liên quan đến hoạt động bảo trì tại {{companyName}}.

Một số ứng dụng phù hợp gồm kiểm tra motor, MCC, biến tần và tủ điện; phát hiện điểm phát nhiệt; đo rung và căn chỉnh trục; kiểm tra chất lượng điện; phát hiện rò rỉ khí nén và kiểm tra cách điện trong môi trường công nghiệp nặng.

Nếu Anh/Chị cho biết hạng mục đang ưu tiên, tôi sẽ gửi giải pháp sát với nhu cầu thực tế.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất ứng dụng Fluke tại {{plantSite}}", `Kính gửi Anh/Chị,

Dựa trên đặc thù vận hành tại {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Giải pháp có thể được xây theo từng nhóm: điện, motor, thiết bị quay, lò nung, khí nén hoặc quản lý năng lượng. Loriot có thể hỗ trợ tư vấn lựa chọn thiết bị, tài liệu kỹ thuật và phương án demo nếu cần.

Anh/Chị có thể chia sẻ thiết bị hoặc khu vực đang gặp vấn đề để tôi chuẩn bị đề xuất phù hợp không?`),
      step(4, "Xác nhận cuối", 7, "Xin xác nhận kế hoạch bảo trì tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép gửi email cuối trong chuỗi trao đổi về giải pháp Fluke cho {{companyName}}.

Nếu nhà máy chưa có kế hoạch đầu tư trong thời gian này, tôi xin phép lưu thông tin để liên hệ lại sau. Nếu có nhu cầu kiểm tra điện, nhiệt, rung động, căn chỉnh hoặc rò rỉ khí, Loriot sẵn sàng hỗ trợ tư vấn.

Rất mong Anh/Chị phản hồi thời điểm phù hợp hoặc giới thiệu giúp bộ phận phụ trách.`),
    ],
  },
  {
    id: "food-beverage",
    groupName: "F&B",
    description: "Nhiệt độ, kho lạnh, steam, HVAC, khí nén, calibration và an toàn điện.",
    keywords: ["thuc pham", "do uong", "food", "beverage", "f&b", "sua", "bia", "dairy", "thuc an chan nuoi", "dinh duong"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp kiểm tra nhiệt độ và bảo trì cho {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Trong ngành thực phẩm và đồ uống, độ ổn định của nhiệt độ, kho lạnh, HVAC, steam, khí nén và hệ thống điện ảnh hưởng trực tiếp đến chất lượng sản phẩm và thời gian vận hành.

Loriot cung cấp các giải pháp Fluke phục vụ đo nhiệt độ, hiệu chuẩn, kiểm tra điện, camera nhiệt, quản lý năng lượng và phát hiện rò rỉ khí.

Anh/Chị có thể giúp tôi kết nối với bộ phận kỹ thuật, utility hoặc QA/QC phù hợp được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp kiểm tra nhiệt độ và bảo trì cho {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up email đã gửi tới {{companyName}}.

Một số ứng dụng thường được quan tâm gồm kiểm tra nhiệt độ trong sản xuất và kho lạnh, kiểm tra steam và HVAC, phát hiện rò rỉ khí nén, kiểm tra motor và biến tần, hiệu chuẩn cảm biến, cùng theo dõi tiêu thụ điện và chất lượng nguồn.

Anh/Chị đang ưu tiên kiểm soát nhiệt độ, utility hay bảo trì điện? Tôi sẽ gửi đúng tài liệu tương ứng.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất giải pháp Fluke cho {{plantSite}}", `Kính gửi Anh/Chị,

Dựa trên hoạt động sản xuất tại {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Loriot có thể hỗ trợ lựa chọn thiết bị theo yêu cầu về nhiệt độ, calibration, kho lạnh, khí nén, HVAC hoặc bảo trì điện.

Nếu Anh/Chị cung cấp dải đo, loại cảm biến hoặc hạng mục đang cần kiểm tra, tôi có thể chuẩn bị đề xuất kỹ thuật và báo giá phù hợp.`),
      step(4, "Xác nhận cuối", 7, "Xin phép xác nhận nhu cầu của {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up lần cuối về giải pháp Fluke cho hoạt động QA, utility và bảo trì tại {{companyName}}.

Nếu hiện tại công ty chưa có nhu cầu, tôi xin phép liên hệ lại vào thời điểm thích hợp. Khi phát sinh nhu cầu đo nhiệt độ, hiệu chuẩn, kiểm tra kho lạnh, khí nén hoặc hệ thống điện, Loriot sẵn sàng hỗ trợ.

Nếu Anh/Chị không phụ trách nội dung này, rất mong Anh/Chị chuyển giúp tới bộ phận kỹ thuật hoặc QA/QC.`),
    ],
  },
  {
    id: "power-solar",
    groupName: "Power/Solar",
    description: "Commissioning, PV, cách điện, tiếp địa, power quality và kiểm tra nhiệt.",
    keywords: ["dien luc", "utility", "power", "solar", "pv", "nang luong", "thuy dien", "nhiet dien", "dien gio", "dien mat troi"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp đo kiểm Fluke cho {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Đối với hệ thống điện và điện mặt trời, các công việc như commissioning, đo đặc tuyến I–V, kiểm tra cách điện, tiếp địa, chất lượng điện và phát hiện điểm nóng có vai trò quan trọng trong vận hành an toàn và ổn định.

Loriot cung cấp các giải pháp Fluke phục vụ kiểm tra hệ thống điện, PV, power quality và camera nhiệt.

Anh/Chị có thể giúp tôi kết nối với bộ phận O&M, thí nghiệm điện hoặc kỹ thuật dự án được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp đo kiểm Fluke cho {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up nội dung đã gửi về giải pháp Fluke cho {{companyName}}.

Các ứng dụng chúng tôi có thể hỗ trợ gồm commissioning và kiểm tra hiệu suất PV, đo Voc/Isc và đặc tuyến I–V, kiểm tra cách điện và tiếp địa, phân tích chất lượng điện, phát hiện điểm nóng trên module và kiểm tra inverter, cáp, tủ điện.

Anh/Chị đang phụ trách vận hành, EPC hay thí nghiệm điện? Tôi sẽ gửi đúng giải pháp theo công việc thực tế.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất thiết bị đo kiểm cho {{plantSite}}", `Kính gửi Anh/Chị,

Dựa trên thông tin về {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Loriot có thể hỗ trợ xây dựng bộ thiết bị theo từng nhiệm vụ: commissioning, O&M, kiểm tra sự cố, power quality, tiếp địa hoặc kiểm tra nhiệt.

Nếu Anh/Chị chia sẻ công suất hệ thống và phạm vi công việc, tôi sẽ chuẩn bị cấu hình phù hợp cùng tài liệu và báo giá tham khảo.`),
      step(4, "Xác nhận cuối", 7, "Xin xác nhận nhu cầu đo kiểm tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép gửi lời nhắc cuối liên quan đến giải pháp Fluke cho {{companyName}}.

Nếu đơn vị chưa có kế hoạch đầu tư trong thời gian này, tôi xin phép liên hệ lại khi phù hợp. Khi phát sinh nhu cầu commissioning, kiểm tra PV, cách điện, tiếp địa, chất lượng điện hoặc camera nhiệt, Loriot sẵn sàng hỗ trợ.

Rất mong Anh/Chị phản hồi thời điểm phù hợp hoặc giới thiệu giúp người phụ trách trực tiếp.`),
    ],
  },
  {
    id: "oil-gas-chemical",
    groupName: "Oil & Gas/Chemical",
    description: "Process calibration, vòng dòng 4–20 mA, pressure, temperature và an toàn hiện trường.",
    keywords: ["dau khi", "oil", "gas", "hoa chat", "chemical", "hoa dau", "petrochemical", "loc dau", "phan bon", "phot pho"],
    steps: [
      step(1, "Tiếp cận ban đầu", 0, "Giải pháp Fluke cho bảo trì và hiệu chuẩn tại {{companyName}}", `Kính gửi Anh/Chị phụ trách {{targetDepartment}} tại {{companyName}},

Tôi là Mai Trần Thành, phụ trách giải pháp thiết bị đo Fluke tại Loriot Industrial.

Trong ngành dầu khí và hóa chất, độ chính xác của thiết bị đo, vòng dòng 4–20 mA, pressure, temperature và an toàn khi kiểm tra tại hiện trường là những yêu cầu đặc biệt quan trọng.

Loriot cung cấp các giải pháp Fluke phục vụ process calibration, kiểm tra điện, camera nhiệt, phát hiện rò rỉ và bảo trì dự báo.

Anh/Chị có thể giúp tôi kết nối với bộ phận Instrumentation, Maintenance hoặc Reliability được không?`),
      step(2, "Follow-up ứng dụng", 3, "Re: Giải pháp Fluke cho bảo trì và hiệu chuẩn tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up email đã gửi tới {{companyName}}.

Một số ứng dụng phù hợp gồm kiểm tra và hiệu chuẩn vòng dòng 4–20 mA, đo và hiệu chuẩn pressure/temperature, kiểm tra thiết bị điện tại hiện trường, camera nhiệt, phát hiện rò rỉ khí, kiểm tra cách điện, tiếp địa và chất lượng nguồn.

Anh/Chị đang ưu tiên calibration, electrical maintenance hay reliability? Tôi sẽ gửi nội dung phù hợp.`),
      step(3, "Đề xuất giải pháp", 5, "Đề xuất giải pháp đo và hiệu chuẩn cho {{plantSite}}", `Kính gửi Anh/Chị,

Dựa trên đặc thù vận hành của {{plantSite}}, chúng tôi đề xuất tham khảo:

{{recommendedSolution}}

Loriot có thể hỗ trợ lựa chọn thiết bị phù hợp với dải đo, độ chính xác, môi trường sử dụng và yêu cầu an toàn của nhà máy.

Nếu Anh/Chị cung cấp thông tin về tín hiệu, pressure range, temperature range hoặc tiêu chuẩn đang áp dụng, tôi sẽ chuẩn bị đề xuất kỹ thuật và báo giá phù hợp.`),
      step(4, "Xác nhận cuối", 7, "Xin phép xác nhận nhu cầu tại {{companyName}}", `Kính gửi Anh/Chị,

Tôi xin phép follow-up lần cuối về giải pháp đo kiểm và hiệu chuẩn Fluke cho {{companyName}}.

Nếu hiện tại chưa có nhu cầu, tôi xin phép lưu lại thông tin để liên hệ vào thời điểm phù hợp hơn. Khi nhà máy cần thiết bị process calibration, kiểm tra điện, camera nhiệt hoặc phát hiện rò rỉ, Loriot sẵn sàng hỗ trợ.

Nếu Anh/Chị không phải người phụ trách, rất mong Anh/Chị chuyển giúp thông tin tới bộ phận Instrumentation hoặc Maintenance.`),
    ],
  },
];

export const normalizeIndustryText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export const industryTemplateForLead = (industry: string) => {
  const normalized = normalizeIndustryText(industry);
  return INDUSTRY_EMAIL_TEMPLATES.find((template) => template.keywords.some((keyword) => normalized.includes(keyword)));
};

export const industryTemplateById = (id: string) => INDUSTRY_EMAIL_TEMPLATES.find((template) => template.id === id);
